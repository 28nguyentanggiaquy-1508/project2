from __future__ import annotations

import asyncio

from fact_checking.evidence.evidence_ranker import rerank_evidence
from fact_checking.evidence.evidence_schema import EvidenceItem
from fact_checking.evidence.image_retriever import retrieve_image_evidence
from fact_checking.evidence.text_retriever import retrieve_text_evidence


def _claim_text(claim) -> str:
    if isinstance(claim, str):
        return claim.strip()

    if isinstance(claim, dict):
        return str(claim.get("text") or "").strip()

    if hasattr(claim, "text"):
        return str(claim.text or "").strip()

    return str(claim or "").strip()


async def retrieve_evidence(
    claim,
    multimedia=None,
) -> list[EvidenceItem]:
    """
    Stage 2: retrieve text and image evidence independently, then re-rank.

    `multimedia` is accepted for forward compatibility; Phase 3 retrieval is
    claim-driven, matching the MOCHEG-style evidence retrieval formulation.
    """
    claim_text = _claim_text(claim)

    if not claim_text:
        return []

    tasks = [
        asyncio.to_thread(
            retrieve_text_evidence,
            claim_text,
        ),
        asyncio.to_thread(
            retrieve_image_evidence,
            claim_text,
        ),
    ]

    results = await asyncio.gather(
        *tasks,
        return_exceptions=True,
    )

    all_evidence: list[EvidenceItem] = []

    for result in results:
        if isinstance(result, Exception):
            continue

        if isinstance(result, list):
            all_evidence.extend(
                item
                for item in result
                if isinstance(item, EvidenceItem)
            )

    if not all_evidence:
        return []

    return await rerank_evidence(
        claim=claim_text,
        evidence=all_evidence,
    )