from __future__ import annotations

import asyncio

from pydantic import ValidationError

from core.gemini_vision import analyze_tiktok_multimedia
from fact_checking.schemas import (
    CandidateClaim,
    MultimediaAnalysis,
    OCRSegment,
    SpeechSegment,
    VisualObservation,
)


def _validate_items(model_type, raw_items):
    valid = []

    if not isinstance(raw_items, list):
        return valid

    for item in raw_items:
        try:
            valid.append(model_type.model_validate(item))
        except (ValidationError, TypeError, ValueError):
            continue

    return valid


def _normalize_content_type(value) -> str:
    content_type = str(value or "uncertain").strip().lower()
    if content_type not in {"real_world", "fictional", "mixed", "uncertain"}:
        return "uncertain"
    return content_type


async def analyze_multimedia(video_url: str) -> MultimediaAnalysis:
    """
    Stage 1A:
    TikTok URL -> multimedia observations + raw candidate claims.

    The existing Gemini video path is executed in a worker thread because the
    Google client and video download helpers are synchronous.
    """
    raw = await asyncio.to_thread(
        analyze_tiktok_multimedia,
        video_url,
    )

    if not isinstance(raw, dict):
        raw = {}

    visual_observations = _validate_items(
        VisualObservation,
        raw.get("visual_observations", []),
    )
    speech_segments = _validate_items(
        SpeechSegment,
        raw.get("speech_segments", []),
    )
    ocr_segments = _validate_items(
        OCRSegment,
        raw.get("ocr_segments", []),
    )
    candidate_claims = _validate_items(
        CandidateClaim,
        raw.get("candidate_claims", []),
    )

    # Ensure stable IDs even if the VLM omitted/duplicated them.
    normalized_claims = []
    seen_ids = set()

    for index, claim in enumerate(candidate_claims, start=1):
        claim_id = (claim.id or "").strip()

        if not claim_id or claim_id in seen_ids:
            claim_id = f"claim_{index:02d}"

        seen_ids.add(claim_id)
        normalized_claims.append(
            claim.model_copy(update={"id": claim_id})
        )

    return MultimediaAnalysis(
        video_url=video_url,
        content_type=_normalize_content_type(raw.get("content_type")),
        visual_observations=visual_observations,
        speech_segments=speech_segments,
        speech_transcript=str(raw.get("speech_transcript") or "").strip(),
        ocr_segments=ocr_segments,
        ocr_text=str(raw.get("ocr_text") or "").strip(),
        caption=(
            str(raw.get("caption")).strip()
            if raw.get("caption") not in (None, "")
            else None
        ),
        candidate_claims=normalized_claims,
        cross_modal_notes=[
            str(item).strip()
            for item in raw.get("cross_modal_notes", [])
            if str(item).strip()
        ]
        if isinstance(raw.get("cross_modal_notes"), list)
        else [],
        metadata=raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {},
        source=str(raw.get("source") or ""),
        error=str(raw.get("error")) if raw.get("error") else None,
    )
