from __future__ import annotations

import asyncio

from config import GEMINI_ANALYST_MODEL
from fact_checking.evidence.evidence_schema import EvidenceItem
from fact_checking.schemas import CandidateClaim, MultimediaAnalysis
from fact_checking.verification.verification_schema import (
    EvidenceAssessment,
    VerificationResult,
)
from fact_checking.verification.vlm_verifier import verify_with_vlm_sync


ALLOWED_VERDICTS = {"SUPPORTED", "REFUTED", "NEI"}
ALLOWED_STANCES = {"support", "refute", "neutral"}


def _clamp_score(value, default: float = 0.0) -> float:
    try:
        score = float(value)
    except (TypeError, ValueError):
        score = default

    return max(0.0, min(1.0, score))


def _nei_result(
    *,
    reason: str,
    limitations: list[str] | None = None,
) -> VerificationResult:
    return VerificationResult(
        verdict="NEI",
        confidence=0.0,
        evidence_ids=[],
        evidence_assessments=[],
        rationale=reason,
        uncertainty=reason,
        limitations=limitations or [],
        multimodal_used=False,
        model=GEMINI_ANALYST_MODEL,
    )


def _normalize_result(
    raw: dict,
    evidence: list[EvidenceItem],
) -> VerificationResult:
    valid_ids = {item.id for item in evidence}

    verdict = str(raw.get("verdict") or "NEI").upper().strip()

    if verdict not in ALLOWED_VERDICTS:
        verdict = "NEI"

    confidence = _clamp_score(raw.get("confidence"))

    raw_ids = raw.get("evidence_ids")
    evidence_ids = []

    if isinstance(raw_ids, list):
        for value in raw_ids:
            evidence_id = str(value).strip()

            if evidence_id in valid_ids and evidence_id not in evidence_ids:
                evidence_ids.append(evidence_id)

    assessments = []

    raw_assessments = raw.get("evidence_assessments")

    if isinstance(raw_assessments, list):
        for row in raw_assessments:
            if not isinstance(row, dict):
                continue

            evidence_id = str(row.get("evidence_id") or "").strip()

            if evidence_id not in valid_ids:
                continue

            stance = str(row.get("stance") or "neutral").lower().strip()

            if stance not in ALLOWED_STANCES:
                stance = "neutral"

            assessments.append(
                EvidenceAssessment(
                    evidence_id=evidence_id,
                    stance=stance,
                    confidence=_clamp_score(row.get("confidence")),
                    rationale=str(row.get("rationale") or "").strip(),
                )
            )

    # If the model forgot evidence_ids but produced valid assessments,
    # recover provenance from non-neutral assessments.
    if not evidence_ids:
        for assessment in assessments:
            if assessment.stance != "neutral":
                evidence_ids.append(assessment.evidence_id)

    rationale = str(raw.get("rationale") or "").strip()
    uncertainty = str(raw.get("uncertainty") or "").strip()

    raw_limitations = raw.get("limitations")
    limitations = []

    if isinstance(raw_limitations, list):
        limitations = [
            str(item).strip()
            for item in raw_limitations
            if str(item).strip()
        ][:10]

    attached_image_count = int(raw.get("_attached_image_count") or 0)
    multimodal_used = bool(raw.get("multimodal_used")) and attached_image_count > 0

    # Fail-safe grounding rule:
    # Supported / Refuted is not allowed without an actual evidence citation.
    if verdict in {"SUPPORTED", "REFUTED"} and not evidence_ids:
        verdict = "NEI"
        confidence = min(confidence, 0.35)
        limitations.append(
            "Model did not cite a valid retrieved evidence item for a decisive verdict."
        )
        uncertainty = (
            uncertainty
            or "Không có bằng chứng truy xuất hợp lệ được dẫn cho kết luận quyết định."
        )

    # A decisive verdict should have at least one evidence item whose stance
    # matches the ruling. Otherwise downgrade to NEI.
    expected_stance = {
        "SUPPORTED": "support",
        "REFUTED": "refute",
    }.get(verdict)

    if expected_stance:
        has_matching_stance = any(
            assessment.evidence_id in evidence_ids
            and assessment.stance == expected_stance
            for assessment in assessments
        )

        if not has_matching_stance:
            verdict = "NEI"
            confidence = min(confidence, 0.35)
            limitations.append(
                "No cited evidence assessment had a stance matching the decisive verdict."
            )

    if verdict == "NEI" and not uncertainty:
        uncertainty = "Bằng chứng hiện có chưa đủ để đưa ra kết luận chắc chắn."

    return VerificationResult(
        verdict=verdict,
        confidence=confidence,
        evidence_ids=evidence_ids,
        evidence_assessments=assessments,
        rationale=rationale,
        uncertainty=uncertainty,
        limitations=limitations,
        multimodal_used=multimodal_used,
        model=str(raw.get("_model") or GEMINI_ANALYST_MODEL),
    )


async def verify_claim(
    claim: CandidateClaim,
    multimedia: MultimediaAnalysis,
    evidence: list[EvidenceItem],
    reasoning_support: dict,
) -> VerificationResult:
    """
    Phase 4: Multimodal Claim Verification.

    MOCHEG-inspired task contract:
        claim + retrieved multimodal evidence -> SUPPORTED / REFUTED / NEI

    CoReS-inspired input:
        filtered key concepts + reasoning-support text are supplied as
        intermediate evidence integration support.

    The returned rationale is a concise evidence-grounded justification and
    deliberately not a hidden chain-of-thought trace.
    """
    if not evidence:
        return _nei_result(
            reason="Không có bằng chứng truy xuất đủ để xác minh claim.",
            limitations=[
                "Evidence retrieval returned no usable text or image evidence."
            ],
        )

    try:
        raw = await asyncio.to_thread(
            verify_with_vlm_sync,
            claim,
            multimedia,
            evidence,
            reasoning_support,
        )
    except Exception as exc:
        return _nei_result(
            reason="Không thể hoàn tất bước xác minh đa phương thức; hệ thống giữ nhãn NEI thay vì đoán.",
            limitations=[
                f"Verifier error: {type(exc).__name__}: {exc}"
            ],
        )

    return _normalize_result(raw, evidence)