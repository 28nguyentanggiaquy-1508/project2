from __future__ import annotations

from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from fact_checking.pipeline import run_fact_check_pipeline


router = APIRouter(
    prefix="/fact-check",
    tags=["Fact Checking"],
)


class FactCheckRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2048)


def _validate_tiktok_url(url: str) -> str:
    value = (url or "").strip()

    try:
        parsed = urlparse(value)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"URL không hợp lệ: {exc}")

    host = (parsed.hostname or "").lower()

    if parsed.scheme not in {"http", "https"}:
        raise HTTPException(
            status_code=400,
            detail="Chỉ chấp nhận TikTok URL dùng http/https.",
        )

    if not (host == "tiktok.com" or host.endswith(".tiktok.com")):
        raise HTTPException(
            status_code=400,
            detail="Endpoint này chỉ nhận URL thuộc tiktok.com.",
        )

    return value


@router.post("")
async def fact_check(request: FactCheckRequest):
    video_url = _validate_tiktok_url(request.url)
    return await run_fact_check_pipeline(video_url)


@router.get("/health")
def fact_check_health():
    return {
        "status": "ok",
        "pipeline": "multimodal-fact-checking",
        "implemented_through": "phase_4",
    }