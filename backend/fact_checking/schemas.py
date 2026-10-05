from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


SourceModality = Literal[
    "speech",
    "ocr",
    "caption",
    "visual",
    "cross_modal",
]

ClaimType = Literal[
    "statistical",
    "event_place_person",
    "other_factual",
    "authenticity_context",
]

ContentType = Literal[
    "real_world",
    "fictional",
    "mixed",
    "uncertain",
]


class StrictBaseModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class VisualObservation(StrictBaseModel):
    timestamp: Optional[str] = None
    fact: str = Field(min_length=1)


class SpeechSegment(StrictBaseModel):
    timestamp: Optional[str] = None
    text: str = Field(min_length=1)


class OCRSegment(StrictBaseModel):
    timestamp: Optional[str] = None
    text: str = Field(min_length=1)


class CandidateClaim(StrictBaseModel):
    id: str = ""
    text: str = Field(min_length=1)
    source_modality: SourceModality
    timestamp: Optional[str] = None
    checkable: bool = True
    check_worthy: bool = True
    claim_type: ClaimType = "other_factual"
    rationale: str = ""


class MultimediaAnalysis(StrictBaseModel):
    video_url: str
    content_type: ContentType = "uncertain"

    visual_observations: list[VisualObservation] = Field(default_factory=list)
    speech_segments: list[SpeechSegment] = Field(default_factory=list)
    speech_transcript: str = ""

    ocr_segments: list[OCRSegment] = Field(default_factory=list)
    ocr_text: str = ""

    caption: Optional[str] = None

    candidate_claims: list[CandidateClaim] = Field(default_factory=list)
    cross_modal_notes: list[str] = Field(default_factory=list)

    metadata: dict = Field(default_factory=dict)
    source: str = ""
    error: Optional[str] = None
