from __future__ import annotations

from fact_checking.claims.claim_service import extract_claims
from fact_checking.evidence.evidence_service import retrieve_evidence
from fact_checking.multimedia.multimedia_service import analyze_multimedia
from fact_checking.reasoning.reasoning_support import build_reasoning_support
from fact_checking.verification.verification_service import verify_claim


async def run_fact_check_pipeline(video_url: str) -> dict:
    """
    Integrated Phase 1 -> Phase 4 pipeline.

    Phase 1:
        API + separate V2 pipeline beside the legacy emotion pipeline.

    Phase 2:
        multimedia understanding + claim detection / extraction.

    Phase 3:
        text/image evidence retrieval + re-ranking +
        CoReS-inspired reasoning-support preparation.

    Phase 4:
        multimodal claim verification with evidence-grounded
        SUPPORTED / REFUTED / NEI output.

    Phase 5:
        not implemented yet; explanation remains None.
    """

    # ============================================================
    # PHASE 2: MULTIMEDIA + CLAIM EXTRACTION
    # ============================================================

    multimedia = await analyze_multimedia(video_url)
    claims = await extract_claims(multimedia)

    claim_results = []

    # ============================================================
    # PHASE 3 + PHASE 4
    # ============================================================

    for claim in claims:
        try:
            evidence = await retrieve_evidence(
                claim=claim,
                multimedia=multimedia,
            )

            reasoning_support = await build_reasoning_support(
                claim=claim.text,
                evidence=evidence,
            )

            verification = await verify_claim(
                claim=claim,
                multimedia=multimedia,
                evidence=evidence,
                reasoning_support=reasoning_support,
            )

            claim_results.append(
                {
                    "claim": claim.model_dump(),
                    "evidence": [
                        item.model_dump()
                        for item in evidence
                    ],
                    "reasoning_support": reasoning_support,
                    "verification": verification.model_dump(),
                    "explanation": None,
                    "error": None,
                }
            )

        except Exception as exc:
            claim_results.append(
                {
                    "claim": claim.model_dump(),
                    "evidence": [],
                    "reasoning_support": {
                        "key_concepts": [],
                        "reasoning_support": "",
                        "semantic_consistency": {
                            "text": None,
                            "image": None,
                            "overall": None,
                        },
                    },
                    "verification": {
                        "verdict": "NEI",
                        "confidence": 0.0,
                        "evidence_ids": [],
                        "evidence_assessments": [],
                        "rationale": (
                            "Pipeline gặp lỗi trước khi hoàn tất xác minh; "
                            "hệ thống giữ nhãn NEI thay vì đoán."
                        ),
                        "uncertainty": str(exc),
                        "limitations": [
                            f"{type(exc).__name__}: {exc}"
                        ],
                        "multimodal_used": False,
                        "model": "",
                    },
                    "explanation": None,
                    "error": f"{type(exc).__name__}: {exc}",
                }
            )

    # ============================================================
    # PIPELINE STATUS
    # ============================================================

    verdict_ready = bool(claim_results) and all(
        isinstance(item.get("verification"), dict)
        and item["verification"].get("verdict")
        in {"SUPPORTED", "REFUTED", "NEI"}
        for item in claim_results
    )

    # ============================================================
    # SKIP / ERROR REASON
    # ============================================================

    skip_reason = None

    if not claim_results:
        if getattr(multimedia, "error", None):
            skip_reason = (
                "Multimedia Analysis không hoàn tất nên chưa thể xác định "
                "candidate claim. "
                f"Lỗi: {multimedia.error}"
            )

        elif getattr(multimedia, "content_type", "uncertain") == "fictional":
            skip_reason = (
                "Video chủ yếu là nội dung hư cấu; "
                "không phát hiện factual claim ngoài đời thực "
                "đủ điều kiện kiểm chứng."
            )

        else:
            skip_reason = (
                "Multimedia Analysis thành công nhưng "
                "không phát hiện checkable/check-worthy claim "
                "để tiếp tục Evidence Retrieval."
            )

    # ============================================================
    # FINAL RESPONSE
    # ============================================================

    return {
        "pipeline_version": "v2-phase1-4",
        "implemented_through": "phase_4",
        "video_url": video_url,
        "multimedia": multimedia.model_dump(),
        "claims": claim_results,
        "claim_count": len(claim_results),
        "verdict_ready": verdict_ready,
        "explanation_ready": False,
        "skip_reason": skip_reason,
    }
