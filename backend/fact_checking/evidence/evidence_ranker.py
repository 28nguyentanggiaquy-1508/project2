from __future__ import annotations

import asyncio
import json

from google import genai
from google.genai import types

from config import (
    GEMINI_ANALYST_MODEL,
    GEMINI_API_KEY,
    IMAGE_EVIDENCE_TOP_K,
    TEXT_EVIDENCE_TOP_K,
)

from core.gemini_utils import (
    generate_content_with_retry,
)

from fact_checking.evidence.evidence_schema import EvidenceItem


_client = (
    genai.Client(api_key=GEMINI_API_KEY)
    if GEMINI_API_KEY
    else None
)


def _extract_json(text: str) -> dict:
    if not text:
        return {}

    try:
        return json.loads(text)
    except Exception:
        pass

    start = text.find("{")
    end = text.rfind("}")

    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except Exception:
            return {}

    return {}


def _response_text(response) -> str:
    text = getattr(response, "text", None)

    if text:
        return text

    chunks = []

    for candidate in getattr(response, "candidates", None) or []:
        content = getattr(candidate, "content", None)

        for part in getattr(content, "parts", None) or []:
            value = getattr(part, "text", None)

            if value:
                chunks.append(value)

    return "".join(chunks)


def _rerank_text_sync(
    claim: str,
    candidates: list[EvidenceItem],
) -> dict[str, float]:
    if _client is None or not candidates:
        return {}

    payload = [
        {
            "id": item.id,
            "title": item.title,
            "content": item.content[:1200],
            "source_domain": item.source_domain,
            "retrieval_score": item.retrieval_score,
        }
        for item in candidates
    ]

    prompt = f"""
Ban la Text Evidence Relevance Reranker trong he thong fact-checking.

CLAIM:
{claim}

CANDIDATE TEXT EVIDENCE:
{json.dumps(payload, ensure_ascii=False)}

NHIEM VU:
- Chi danh gia candidate co LIEN QUAN toi claim den muc nao.
- KHONG danh gia claim dung hay sai.
- KHONG tao evidence moi.
- KHONG dung kien thuc ngoai candidate.
- relevance_score nam trong [0, 1].

Tra DUY NHAT JSON:

{{
  "scores": [
    {{
      "id": "text_01_000",
      "relevance_score": 0.92
    }}
  ]
}}
""".strip()

    response, model_used = generate_content_with_retry(
        _client,
        model=GEMINI_ANALYST_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            thinking_config=types.ThinkingConfig(
                thinking_level="low"
        ),
    ),
)

    data = _extract_json(_response_text(response))

    score_map = {}

    for row in data.get("scores", []):
        if not isinstance(row, dict) or not row.get("id"):
            continue

        try:
            value = float(row.get("relevance_score", 0.0))
        except (TypeError, ValueError):
            continue

        score_map[str(row["id"])] = max(0.0, min(1.0, value))

    return score_map


async def rerank_evidence(
    claim: str,
    evidence: list[EvidenceItem],
) -> list[EvidenceItem]:
    """
    MOCHEG-style modality-aware ranking:
    - text candidates: retrieval + second-stage semantic reranker;
    - image candidates: CLIP retrieval ranking.

    The Gemini reranker sees text evidence only. We do not pretend that
    image metadata is equivalent to visually re-ranking the image itself.
    """
    text_candidates = sorted(
        [item for item in evidence if item.modality == "text"],
        key=lambda item: item.retrieval_score,
        reverse=True,
    )

    image_candidates = sorted(
        [item for item in evidence if item.modality == "image"],
        key=lambda item: item.retrieval_score,
        reverse=True,
    )

    score_map = {}

    if _client is not None and text_candidates:
        try:
            score_map = await asyncio.to_thread(
                _rerank_text_sync,
                claim,
                text_candidates[:20],
            )
        except Exception:
            score_map = {}

    reranked_text = []

    for item in text_candidates:
        semantic_score = score_map.get(item.id)

        if semantic_score is None:
            reranked_text.append(item)
            continue

        # Project-level engineering choice, not a MOCHEG paper coefficient.
        combined = (
            0.40 * item.retrieval_score
            + 0.60 * semantic_score
        )

        reranked_text.append(
            item.model_copy(
                update={
                    "rerank_score": semantic_score,
                    "relevance_score": max(0.0, min(1.0, combined)),
                }
            )
        )

    reranked_text.sort(
        key=lambda item: item.relevance_score,
        reverse=True,
    )

    # Image relevance remains grounded in the CLIP image-text score.
    image_candidates = [
        item.model_copy(
            update={"relevance_score": item.retrieval_score}
        )
        for item in image_candidates
    ]

    return (
        reranked_text[:TEXT_EVIDENCE_TOP_K]
        + image_candidates[:IMAGE_EVIDENCE_TOP_K]
    )