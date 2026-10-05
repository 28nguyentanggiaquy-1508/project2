from __future__ import annotations

import json
from io import BytesIO

from google import genai
from google.genai import types

from config import (
    GEMINI_ANALYST_MODEL,
    GEMINI_API_KEY,
    VERIFICATION_MAX_EVIDENCE_CHARS,
    VERIFICATION_MAX_IMAGES,
)

from core.gemini_utils import (
    generate_content_with_retry,
)

from fact_checking.evidence.evidence_schema import EvidenceItem
from fact_checking.evidence.image_retriever import load_remote_image
from fact_checking.schemas import CandidateClaim, MultimediaAnalysis


_client = (
    genai.Client(api_key=GEMINI_API_KEY)
    if GEMINI_API_KEY
    else None
)


ALLOWED_VERDICTS = {"SUPPORTED", "REFUTED", "NEI"}
ALLOWED_STANCES = {"support", "refute", "neutral"}


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


def _multimedia_context(
    claim: CandidateClaim,
    multimedia: MultimediaAnalysis,
) -> dict:
    """
    Preserve provenance from the TikTok source without re-inventing facts.
    Only observations produced in Phase 2 are passed to verification.
    """
    return {
        "claim_source_modality": claim.source_modality,
        "claim_timestamp": claim.timestamp,
        "claim_type": claim.claim_type,
        "visual_observations": [
            item.model_dump()
            for item in multimedia.visual_observations[:20]
        ],
        "speech_segments": [
            item.model_dump()
            for item in multimedia.speech_segments[:30]
        ],
        "ocr_segments": [
            item.model_dump()
            for item in multimedia.ocr_segments[:30]
        ],
        "caption": multimedia.caption,
        "cross_modal_notes": multimedia.cross_modal_notes[:15],
    }


def _evidence_payload(evidence: list[EvidenceItem]) -> list[dict]:
    rows = []

    for item in evidence:
        rows.append(
            {
                "id": item.id,
                "modality": item.modality,
                "title": item.title,
                "source_url": item.source_url,
                "source_domain": item.source_domain,
                "content": item.content[:VERIFICATION_MAX_EVIDENCE_CHARS],
                "retrieval_score": round(float(item.retrieval_score), 4),
                "rerank_score": (
                    round(float(item.rerank_score), 4)
                    if item.rerank_score is not None
                    else None
                ),
                "relevance_score": round(float(item.relevance_score), 4),
            }
        )

    return rows


def _image_part(item: EvidenceItem):
    if item.modality != "image" or not item.media_url:
        return None

    image = load_remote_image(item.media_url)

    if image is None:
        return None

    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=90)

    return types.Part.from_bytes(
        data=buffer.getvalue(),
        mime_type="image/jpeg",
    )


def _build_prompt(
    claim: CandidateClaim,
    multimedia: MultimediaAnalysis,
    evidence: list[EvidenceItem],
    reasoning_support: dict,
) -> str:
    multimedia_payload = _multimedia_context(claim, multimedia)
    evidence_payload = _evidence_payload(evidence)

    support_text = str(
        reasoning_support.get("reasoning_support") or ""
    ).strip()
    key_concepts = reasoning_support.get("key_concepts") or []
    semantic_consistency = reasoning_support.get("semantic_consistency") or {}

    return f"""
# ROLE

Ban la Multimodal Claim Verification module trong he thong fact-checking.

Day la STAGE VERIFICATION. Claim da duoc trich xuat va evidence da duoc retrieval/rerank.
Ban phai xac minh claim CHI dua tren du lieu duoc cung cap.

# CLAIM

{claim.text}

# ORIGINAL TIKTOK MULTIMEDIA CONTEXT

{json.dumps(multimedia_payload, ensure_ascii=False)}

# RETRIEVED EVIDENCE

{json.dumps(evidence_payload, ensure_ascii=False)}

# CONCEPTUAL REASONING SUPPORT

Key concepts:
{json.dumps(key_concepts, ensure_ascii=False)}

Reasoning-support text:
{support_text or "(khong co)"}

Semantic-consistency diagnostic:
{json.dumps(semantic_consistency, ensure_ascii=False)}

# VERDICT LABELS

Chi duoc chon MOT trong ba nhan:

1. SUPPORTED
   Evidence co du va phu hop de ung ho noi dung cot loi cua claim.

2. REFUTED
   Evidence co du va truc tiep mau thuan / bac bo noi dung cot loi cua claim.

3. NEI
   Not Enough Information. Dung khi evidence khong du, chi lien quan gian tiep,
   khong xac minh duoc chi tiet cot loi, hoac evidence xung dot ma khong the ket luan.

# MULTIMODAL RULES

- Phai xem xet moi quan he giua claim voi text evidence VA image evidence neu co.
- Image evidence duoc gui kem sau prompt nay; moi image duoc gan voi mot evidence ID.
- Ngu canh TikTok chi cho biet claim duoc the hien nhu the nao; no KHONG tu dong la
  bang chung rang claim dung.
- Comments / social reaction KHONG duoc xem la authoritative evidence.
- Neu hinh anh va text evidence mau thuan, phai the hien dieu do trong uncertainty.

# EVIDENCE-GROUNDED RULES

- KHONG su dung kien thuc nen ngoai evidence duoc cung cap.
- KHONG tu tao URL, nguon, so lieu hoac su kien.
- Chi tham chieu evidence bang ID co trong RETRIEVED EVIDENCE.
- Neu khong co evidence du de ket luan, BAT BUOC chon NEI.
- SUPPORTED/REFUTED phai co it nhat mot evidence_id thuc su ho tro ket luan.
- relevance_score chi la diem retrieval; KHONG phai do tin cay cua su that.

# EXPLAINABILITY

Khong viet chain-of-thought noi bo.
Chi tao rationale ngan gon, co the kiem tra, neu ro evidence nao ho tro ket luan.

# OUTPUT

Tra DUY NHAT mot JSON object hop le:

{{
  "verdict": "SUPPORTED | REFUTED | NEI",
  "confidence": 0.0,
  "evidence_ids": ["text_...", "image_..."],
  "evidence_assessments": [
    {{
      "evidence_id": "text_...",
      "stance": "support | refute | neutral",
      "confidence": 0.0,
      "rationale": "giai thich ngan gon dua tren noi dung evidence"
    }}
  ],
  "rationale": "giai thich ngan gon cho verdict, co dan evidence ID",
  "uncertainty": "nhung dieu evidence chua xac minh duoc hoac dang mau thuan",
  "limitations": ["..."],
  "multimodal_used": true
}}
""".strip()


def verify_with_vlm_sync(
    claim: CandidateClaim,
    multimedia: MultimediaAnalysis,
    evidence: list[EvidenceItem],
    reasoning_support: dict,
) -> dict:
    if _client is None:
        raise RuntimeError("Gemini client is unavailable")

    prompt = _build_prompt(
        claim=claim,
        multimedia=multimedia,
        evidence=evidence,
        reasoning_support=reasoning_support,
    )

    contents: list = [prompt]
    image_count = 0

    for item in evidence:
        if image_count >= VERIFICATION_MAX_IMAGES:
            break

        if item.modality != "image" or not item.media_url:
            continue

        try:
            image_part = _image_part(item)
        except Exception:
            image_part = None

        if image_part is None:
            continue

        contents.append(
            f"IMAGE_EVIDENCE_ID={item.id}; TITLE={item.title}; SOURCE={item.source_domain}"
        )
        contents.append(image_part)
        image_count += 1

    response, model_used = generate_content_with_retry(
        _client,
        model=GEMINI_ANALYST_MODEL,
        contents=contents,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            thinking_config=types.ThinkingConfig(
                thinking_level="medium"
            ),
    ),
)

    data = _extract_json(_response_text(response))

    if not data:
        raise RuntimeError("Verifier returned invalid JSON")

    data["_attached_image_count"] = image_count
    data["_model"] = GEMINI_ANALYST_MODEL

    return data