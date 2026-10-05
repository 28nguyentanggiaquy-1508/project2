from __future__ import annotations

import asyncio
import json

import torch
from google import genai
from google.genai import types

from config import (
    CONCEPT_CLAIM_THRESHOLD,
    CONCEPT_CLUSTER_THRESHOLD,
    CONCEPT_MIN_FREQ_RATIO,
    GEMINI_ANALYST_MODEL,
    GEMINI_API_KEY,
)
from fact_checking.evidence.evidence_schema import EvidenceItem
from fact_checking.evidence.image_retriever import (
    get_image_encoder,
    load_remote_image,
)

from core.gemini_utils import (
    generate_content_with_retry,
)

from fact_checking.evidence.text_retriever import get_text_encoder


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


def _extract_raw_concepts_sync(
    claim: str,
    text_evidence: list[EvidenceItem],
) -> list[dict]:
    if _client is None or not text_evidence:
        return []

    payload = [
        {
            "id": item.id,
            "content": item.content[:1500],
        }
        for item in text_evidence
    ]

    prompt = f"""
Ban la Concept Extraction module.

CLAIM:
{claim}

TEXT EVIDENCE:
{json.dumps(payload, ensure_ascii=False)}

Trich xuat cac concept factual quan trong trong evidence.
Uu tien:
- nguoi;
- to chuc;
- dia diem;
- su kien;
- so lieu;
- ngay thang;
- quan he subject-predicate-object.

KHONG them kien thuc ngoai evidence.

Tra DUY NHAT JSON:

{{
  "concepts": [
    {{
      "concept": "...",
      "evidence_ids": ["text_01_000"],
      "subject": "...",
      "predicate": "...",
      "object": "..."
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

    return [
        item
        for item in data.get("concepts", [])
        if isinstance(item, dict)
    ]


def _merge_and_filter_concepts(
    claim: str,
    raw_concepts: list[dict],
    evidence_count: int,
) -> list[dict]:
    """
    CoReS-inspired Extract -> Merge -> Filter baseline.

    The thresholds are project engineering defaults and are explicitly
    configurable; they are not claimed as exact paper hyperparameters.
    """
    concepts = []

    for item in raw_concepts:
        text = str(item.get("concept") or "").strip()

        if not text:
            continue

        evidence_ids = {
            str(value).strip()
            for value in item.get("evidence_ids", [])
            if str(value).strip()
        }

        concepts.append(
            {
                "text": text,
                "evidence_ids": evidence_ids,
            }
        )

    if not concepts:
        return []

    encoder = get_text_encoder()

    concept_texts = [item["text"] for item in concepts]
    concept_embeddings = encoder.encode(concept_texts)
    claim_embedding = encoder.encode([claim])[0]

    clusters: list[list[int]] = []
    used = set()

    for i in range(len(concepts)):
        if i in used:
            continue

        cluster = [i]
        used.add(i)

        for j in range(i + 1, len(concepts)):
            if j in used:
                continue

            similarity = torch.dot(
                concept_embeddings[i],
                concept_embeddings[j],
            ).item()

            if similarity >= CONCEPT_CLUSTER_THRESHOLD:
                cluster.append(j)
                used.add(j)

        clusters.append(cluster)

    final = []

    for cluster in clusters:
        evidence_ids = set()

        for index in cluster:
            evidence_ids.update(concepts[index]["evidence_ids"])

        frequency_ratio = (
            len(evidence_ids)
            / max(evidence_count, 1)
        )

        best_index = None
        best_similarity = -1.0

        for index in cluster:
            similarity = torch.dot(
                concept_embeddings[index],
                claim_embedding,
            ).item()

            if similarity > best_similarity:
                best_similarity = similarity
                best_index = index

        if best_index is None:
            continue

        # Keep concepts that recur in evidence OR are strongly related to claim.
        if (
            frequency_ratio < CONCEPT_MIN_FREQ_RATIO
            and best_similarity < CONCEPT_CLAIM_THRESHOLD
        ):
            continue

        final.append(
            {
                "concept": concepts[best_index]["text"],
                "claim_similarity": round(float(best_similarity), 4),
                "frequency_ratio": round(float(frequency_ratio), 4),
                "evidence_ids": sorted(evidence_ids),
            }
        )

    final.sort(
        key=lambda item: (
            item["claim_similarity"],
            item["frequency_ratio"],
        ),
        reverse=True,
    )

    return final


def _generate_reasoning_support_sync(
    claim: str,
    key_concepts: list[dict],
    evidence: list[EvidenceItem],
) -> str:
    if _client is None or not key_concepts:
        return ""

    evidence_payload = [
        {
            "id": item.id,
            "modality": item.modality,
            "title": item.title,
            "content": item.content[:1200],
            "source_domain": item.source_domain,
        }
        for item in evidence
    ]

    prompt = f"""
Ban la Reasoning Support Generator trong he thong fact-checking.

CLAIM:
{claim}

KEY CONCEPTS:
{json.dumps(key_concepts, ensure_ascii=False)}

RETRIEVED EVIDENCE:
{json.dumps(evidence_payload, ensure_ascii=False)}

NHIEM VU:
- Ket noi cac key concept thanh mot doan reasoning-support khach quan.
- Chi dung thong tin co trong evidence.
- Loai bo chi tiet du thua.
- Neu evidence mau thuan, mo ta su mau thuan do.
- KHONG ket luan claim dung hay sai.
- KHONG ghi SUPPORTED / REFUTED / NEI.
- KHONG them kien thuc ngoai evidence.

Tra DUY NHAT JSON:

{{
  "reasoning_support": "..."
}}
""".strip()

    response = _client.models.generate_content(
        model=GEMINI_ANALYST_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
        ),
    )

    data = _extract_json(_response_text(response))
    return str(data.get("reasoning_support") or "").strip()


def _unit_score(cosine_score: float) -> float:
    return max(0.0, min(1.0, (float(cosine_score) + 1.0) / 2.0))


def _semantic_consistency(
    reasoning_text: str,
    evidence: list[EvidenceItem],
) -> dict:
    """
    Lightweight CoReS-inspired diagnostic.

    CoReS optimizes reasoning support with multimodal semantic consistency.
    This Phase-3 baseline measures text-text and image-text alignment and
    exposes the score; it does not claim to reproduce CBART optimization.
    """
    if not reasoning_text:
        return {
            "text": None,
            "image": None,
            "overall": None,
        }

    text_items = [
        item
        for item in evidence
        if item.modality == "text" and item.content
    ]
    image_items = [
        item
        for item in evidence
        if item.modality == "image" and item.media_url
    ]

    text_score = None
    image_score = None

    if text_items:
        encoder = get_text_encoder()

        embeddings = encoder.encode(
            [reasoning_text]
            + [item.content[:1200] for item in text_items]
        )

        support = embeddings[0:1]
        evidence_embeddings = embeddings[1:]

        raw_scores = torch.mm(
            evidence_embeddings,
            support.T,
        ).squeeze(1)

        # Top evidence is more informative than averaging all noisy items.
        top_values = torch.topk(
            raw_scores,
            k=min(3, raw_scores.numel()),
        ).values

        text_score = round(
            _unit_score(float(top_values.mean().item())),
            4,
        )

    if image_items:
        try:
            encoder = get_image_encoder()
            support_embedding = encoder.encode_text(reasoning_text)
            raw_scores = []

            for item in image_items[:3]:
                image = load_remote_image(item.media_url)

                if image is None:
                    continue

                image_embedding = encoder.encode_image(image)
                raw_scores.append(
                    torch.mm(
                        image_embedding,
                        support_embedding.T,
                    ).item()
                )

            if raw_scores:
                image_score = round(
                    sum(_unit_score(value) for value in raw_scores)
                    / len(raw_scores),
                    4,
                )

        except Exception:
            image_score = None

    available = [
        value
        for value in (text_score, image_score)
        if value is not None
    ]

    overall = (
        round(sum(available) / len(available), 4)
        if available
        else None
    )

    return {
        "text": text_score,
        "image": image_score,
        "overall": overall,
    }


async def build_reasoning_support(
    claim: str,
    evidence: list[EvidenceItem],
) -> dict:
    if not evidence:
        return {
            "key_concepts": [],
            "reasoning_support": "",
            "semantic_consistency": {
                "text": None,
                "image": None,
                "overall": None,
            },
        }

    text_evidence = [
        item
        for item in evidence
        if item.modality == "text"
    ]

    raw_concepts = []

    if _client is not None and text_evidence:
        try:
            raw_concepts = await asyncio.to_thread(
                _extract_raw_concepts_sync,
                claim,
                text_evidence,
            )
        except Exception:
            raw_concepts = []

    key_concepts = _merge_and_filter_concepts(
        claim=claim,
        raw_concepts=raw_concepts,
        evidence_count=len(text_evidence),
    )

    reasoning_text = ""

    if _client is not None and key_concepts:
        try:
            reasoning_text = await asyncio.to_thread(
                _generate_reasoning_support_sync,
                claim,
                key_concepts,
                evidence,
            )
        except Exception:
            reasoning_text = ""

    consistency = await asyncio.to_thread(
        _semantic_consistency,
        reasoning_text,
        evidence,
    )

    return {
        "key_concepts": key_concepts,
        "reasoning_support": reasoning_text,
        "semantic_consistency": consistency,
    }