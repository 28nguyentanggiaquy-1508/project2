from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


EvidenceModality = Literal["text", "image"]


class EvidenceItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    modality: EvidenceModality

    title: str = ""
    source_url: str
    source_domain: str = ""

    content: str = ""
    media_url: Optional[str] = None

    retrieval_score: float = Field(default=0.0, ge=0.0, le=1.0)
    rerank_score: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    relevance_score: float = Field(default=0.0, ge=0.0, le=1.0)

    metadata: dict = Field(default_factory=dict)