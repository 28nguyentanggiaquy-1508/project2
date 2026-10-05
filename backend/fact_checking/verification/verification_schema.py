from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


Verdict = Literal["SUPPORTED", "REFUTED", "NEI"]
EvidenceStance = Literal["support", "refute", "neutral"]


class EvidenceAssessment(BaseModel):
    model_config = ConfigDict(extra="ignore")

    evidence_id: str
    stance: EvidenceStance = "neutral"
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    rationale: str = ""


class VerificationResult(BaseModel):
    model_config = ConfigDict(extra="ignore")

    verdict: Verdict = "NEI"
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)

    # Evidence actually used for the final ruling.
    evidence_ids: list[str] = Field(default_factory=list)
    evidence_assessments: list[EvidenceAssessment] = Field(default_factory=list)

    # User-facing evidence-grounded justification, NOT hidden chain-of-thought.
    rationale: str = ""
    uncertainty: str = ""
    limitations: list[str] = Field(default_factory=list)

    # Diagnostics for the report / UI.
    multimodal_used: bool = False
    model: str = ""