from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from services.ai_service import analyze_video
from core.model_manager import get_default_model_id, list_model_options
from core.gemini_vision import get_or_download_video
from typing import Optional
from api.fact_check import router as fact_check_router


app = FastAPI()
app.include_router(fact_check_router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Request(BaseModel):
    url: str
    model_id: Optional[str] = None

@app.post("/analyze")
async def analyze(req: Request):
    return await analyze_video(req.url, model_id=req.model_id)


@app.get("/models")
def models():
    return {
        "default_model_id": get_default_model_id(),
        "models": list_model_options(),
    }


@app.get("/video/{video_id}")
def video_proxy(video_id: str, url: str = Query(...)):
    """
    Stream a TikTok video that has been downloaded server-side, so the frontend
    can render it via <video> instead of the TikTok iframe (which is blocked by
    TikTok's CDN with a 403 when the referer is not tiktok.com).
    """

    if not video_id.isdigit():
        raise HTTPException(status_code=400, detail="Invalid video id")

    try:
        path = get_or_download_video(url, video_id=video_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Cannot fetch video: {exc}")

    if not path.exists():
        raise HTTPException(status_code=404, detail="Video file not found")

    return FileResponse(
        path,
        media_type="video/mp4",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@app.get("/")
def root():
    return {"message": "TikTok Analyzer API is running"}