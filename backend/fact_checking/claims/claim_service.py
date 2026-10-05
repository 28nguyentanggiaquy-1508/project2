from __future__ import annotations

import re

from config import MAX_CHECK_WORTHY_CLAIMS
from fact_checking.schemas import CandidateClaim, MultimediaAnalysis


def _claim_key(text: str) -> str:
    normalized = re.sub(r"\s+", " ", text or "").strip().casefold()
    normalized = re.sub(r"[^\w\s]", "", normalized, flags=re.UNICODE)
    return normalized


async def extract_claims(
    multimedia: MultimediaAnalysis,
) -> list[CandidateClaim]:
    """
    Stage 1B: validate and de-duplicate checkable/check-worthy claims.

    The VLM proposes candidate claims, but this layer controls what is allowed
    to proceed to web evidence retrieval.
    """
    valid_claims: list[CandidateClaim] = []
    seen = set()

    for claim in multimedia.candidate_claims:
        text = re.sub(r"\s+", " ", claim.text or "").strip()

        if not text:
            continue

        if not claim.checkable or not claim.check_worthy:
            continue

        key = _claim_key(text)

        if not key or key in seen:
            continue

        seen.add(key)

        valid_claims.append(
            claim.model_copy(
                update={
                    "text": text,
                    "id": f"claim_{len(valid_claims) + 1:02d}",
                }
            )
        )

        if len(valid_claims) >= MAX_CHECK_WORTHY_CLAIMS:
            break

    return valid_claims