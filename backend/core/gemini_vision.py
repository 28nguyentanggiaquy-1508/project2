import json
import mimetypes
import shutil
import tempfile
import time
from pathlib import Path

import requests
from google import genai
from google.genai import types
import yt_dlp

from config import (
    GEMINI_ANALYST_MODEL,
    GEMINI_API_KEY,
    GEMINI_VISION_MODEL,
)


gemini_client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None


ALLOWED_TONES = ("sad", "funny", "angry", "love", "happy", "neutral")
ALLOWED_TONE_SET = set(ALLOWED_TONES)

VIDEO_CACHE_DIR = Path(__file__).resolve().parent.parent / ".video_cache"
VIDEO_CACHE_DIR.mkdir(exist_ok=True)


def _video_id_from_url(url: str):
    import re as _re
    match = _re.search(r"/video/(\d+)", url or "")
    return match.group(1) if match else None


def get_or_download_video(video_url: str, video_id: str = None) -> Path:
    """
    Return a cached mp4 file for the given video URL, downloading if needed.
    Used by the /video proxy endpoint to bypass TikTok CDN 403 in iframe embeds.
    """

    if not video_id:
        video_id = _video_id_from_url(video_url)

    if video_id:
        cached = VIDEO_CACHE_DIR / f"{video_id}.mp4"
        if cached.exists() and cached.stat().st_size > 0:
            return cached

    path, temp_dir = _download_tiktok_video(video_url)

    try:
        if video_id:
            cached = VIDEO_CACHE_DIR / f"{video_id}.mp4"
            shutil.copy2(path, cached)
            return cached
        return path
    finally:
        if video_id and temp_dir:
            shutil.rmtree(temp_dir, ignore_errors=True)

DESKTOP_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)
MOBILE_USER_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 "
    "Mobile/15E148 Safari/604.1"
)


def _gemini_ready() -> bool:
    return gemini_client is not None


def _extract_json(text: str) -> dict:
    if not text:
        return {}

    try:
        return json.loads(text)
    except Exception:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except Exception:
            return {}

    return {}


def _fallback_context(comments=None) -> dict:
    from core.context_engine import extract_video_context

    return extract_video_context(comments or [])


def _build_video_context_prompt(sample_comments: str) -> str:
    return f"""
# VAI TRO
Ban la chuyen gia phan tich video TikTok da phuong thuc cho thi truong Viet Nam.
Ban xem video duoc upload kem theo va tao ra mot doi tuong NGU CANH (context object)
duoc dung lam dau vao cho mo hinh phan loai cam xuc tren binh luan.

# YEU CAU PHAN TICH (theo thu tu uu tien)
1. HINH ANH: nhan vat, boi canh, hanh dong, do hoa, chu chay tren man hinh, do vat.
2. AM THANH: loi noi, am nhac, hieu ung am thanh, tone giong, ngon ngu noi.
3. CAU TRUC NOI DUNG: mo dau (hook), dien bien, cao trao, ket thuc, twist.
4. BIEU CAM va NGON NGU CO THE: net mat, anh mat, cu chi, nang luong tong the.
5. NGU CANH VAN HOA VN: trend dang hot, meme, slang Gen Z, su kien thoi su lien quan.
6. Suy luan LY DO khan gia VN co the phan ung cam xuc (vui, buon, gian, yeu, bat ngo).

# QUY TAC RANG BUOC
- Comments ben duoi CHI la bang chung yeu, KHONG duoc de comments lat nguoc nhung
  gi ban thay ro trong video. Neu comments mau thuan voi video, uu tien video.
- KHONG bia danh tinh, KHONG suy doan chi tiet rieng tu khong duoc hien thi.
- Phan biet ro: FACT (thay/nghe truc tiep) vs INTERPRETATION (suy luan).
- Chon DUNG MOT primary tone trong: sad, funny, angry, love, happy, neutral.
- "scores" la phan phoi xac suat ky vong (0-100, integer) thuoc cam xuc nguoi xem
  bi tac dong boi NGU CANH VIDEO - KHONG phai ket qua phan loai comment.
  Tong cac score nen xap xi 100, va tone primary phai co diem cao nhat.

# DINH DANG OUTPUT
- Tra ve DUY NHAT mot JSON object hop le. KHONG markdown, KHONG giai thich ngoai JSON.
- Tat ca gia tri text bang TIENG VIET, ngan gon, model-friendly.
- "keywords" la 3-6 tu khoa loi mo ta chu de + sac thai (vd: "nhay-mua", "trend-hot",
  "tinh-cam-gia-dinh", "drama", "review-do-an").

# JSON SHAPE
{{
  "topic": "chu de ngan gon cua video, 3-8 tu",
  "tone": "sad | funny | angry | love | happy | neutral",
  "visual_summary": "1-2 cau mo ta nhung gi that su xay ra trong video, neu ro nhan vat va hanh dong chinh",
  "audience_context": "1-2 cau giai thich vi sao nguoi xem VN co the phan ung cam xuc theo cach do",
  "keywords": ["tu_khoa_1", "tu_khoa_2", "tu_khoa_3"],
  "scores": {{
    "sad": 0,
    "funny": 0,
    "angry": 0,
    "love": 0,
    "happy": 0,
    "neutral": 0
  }}
}}

# SAMPLE COMMENTS (bang chung yeu, dung tham khao)
{sample_comments or "(khong co)"}
""".strip()


def _build_emotion_analyst_prompt(
    summary: dict,
    emotions: dict,
    video_context,
    sample_comments: str,
) -> str:
    return f"""
# VAI TRO
Ban la chuyen gia phan tich insight mang xa hoi cho thi truong Viet Nam.
Ban viet bao cao cam xuc cua nguoi xem TikTok cho chu so huu noi dung,
ket hop 3 nguon du lieu:
1. Ngu canh video tu Gemini Vision (hieu nguoi/canh/hanh dong/am thanh).
2. Phan phoi cam xuc tu mo hinh phan loai binh luan.
3. Cac binh luan tieu bieu.

# YEU CAU CHAT LUONG
- BAM SAT ngu canh video lam diem neo. KHONG noi chung chung kieu "hay tang tuong tac".
- Khi neu nhan dinh, NEU BANG CHUNG (vd: "vi visual_summary cho thay X, comment Y noi Z").
- Khi du lieu mau thuan (vd: video happy nhung comment angry cao), HAY GOI TEN
  mau thuan do va dua ra gia thuyet (vd: drama, hieu nham, troll, fanbase doi lap).
- Goi y hanh dong phai CU THE va lien quan toi noi dung cu the cua video nay.

# KIEM TRA LUAN LY (lam tu duy noi bo truoc khi viet)
- Trigger cam xuc chinh trong video la gi?
- Phan phoi positive/neutral/negative noi len dieu gi ve do don nhan?
- Cam xuc fine-grained noi bat (ENJOYMENT, ANGER, SADNESS, ...) lien he the nao
  voi tone cua video?
- Co dau hieu drama, tranh cai, hay mismatch giua y do va phan ung?

# INPUTS
Video context JSON:
{json.dumps(video_context or {}, ensure_ascii=False)}

Sentiment summary:
{json.dumps(summary, ensure_ascii=False)}

Emotion counts:
{json.dumps(emotions, ensure_ascii=False)}

Representative comments:
{sample_comments or "(khong co)"}

# OUTPUT FORMAT (tieng Viet, markdown nhe, ngan gon, tong 200-350 tu)
**Tong quan cam xuc**
- 2-3 cau ve xu huong chung va con so noi bat.

**Ngu canh video**
- 2-3 cau tom tat video co ban (dua tren visual_summary va keywords).

**Hanh vi nguoi xem**
- 2-3 cau giai thich tai sao nguoi xem phan ung nhu vay, co dan chung tu comment.

**Rui ro / tranh cai**
- 1-2 cau ve mau thuan, drama, hoac rui ro thuong hieu (neu co); neu khong co thi noi ro.

**De xuat toi uu**
- 2-3 gach dau dong, moi gach dau dong la 1 hanh dong CU THE cho video tiep theo
  (chu de, hook, cta, audio, ...). Tranh loi khuyen generic.
""".strip()


def _resolve_short_url(video_url: str) -> str:
    """Follow vm.tiktok.com / vt.tiktok.com shortlinks to the canonical URL."""

    if "tiktok.com" not in video_url:
        return video_url

    if "/video/" in video_url:
        return video_url

    try:
        resp = requests.head(
            video_url,
            headers={"User-Agent": DESKTOP_USER_AGENT},
            allow_redirects=True,
            timeout=10,
        )
        return resp.url or video_url
    except Exception:
        return video_url


def _download_via_ytdlp(video_url: str, temp_dir: str) -> Path:
    output_template = str(Path(temp_dir) / "video.%(ext)s")

    base_headers = {
        "User-Agent": DESKTOP_USER_AGENT,
        "Referer": "https://www.tiktok.com/",
        "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
    }

    attempts = [
        {
            "format": "mp4/best[ext=mp4]/best",
            "http_headers": base_headers,
        },
        {
            "format": "download_addr-0/play_addr-0/best",
            "http_headers": {**base_headers, "User-Agent": MOBILE_USER_AGENT},
        },
        {
            "format": "best",
            "http_headers": base_headers,
            "extractor_args": {"tiktok": {"app_version": ["34.1.2"]}},
        },
    ]

    last_error = None

    for attempt in attempts:
        options = {
            "outtmpl": output_template,
            "merge_output_format": "mp4",
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "retries": 3,
            "fragment_retries": 3,
            "socket_timeout": 30,
            **attempt,
        }

        try:
            with yt_dlp.YoutubeDL(options) as downloader:
                info = downloader.extract_info(video_url, download=True)
                downloaded = downloader.prepare_filename(info)

            path = Path(downloaded)
            if not path.exists():
                mp4_path = Path(temp_dir) / "video.mp4"
                if mp4_path.exists():
                    path = mp4_path

            if path.exists() and path.stat().st_size > 0:
                return path

        except Exception as exc:
            last_error = exc
            continue

    raise RuntimeError(f"yt-dlp failed to download TikTok video: {last_error}")


def _download_via_tikwm(video_url: str, temp_dir: str) -> Path:
    """Public TikTok mirror API used as fallback when yt-dlp is blocked."""

    api_resp = requests.post(
        "https://www.tikwm.com/api/",
        data={"url": video_url, "hd": "1"},
        headers={"User-Agent": DESKTOP_USER_AGENT},
        timeout=20,
    )
    api_resp.raise_for_status()
    payload = api_resp.json()

    if payload.get("code") != 0:
        raise RuntimeError(f"tikwm error: {payload.get('msg')}")

    data = payload.get("data") or {}
    play_path = data.get("hdplay") or data.get("play") or data.get("wmplay")
    if not play_path:
        raise RuntimeError("tikwm response missing play URL")

    if play_path.startswith("/"):
        play_url = f"https://www.tikwm.com{play_path}"
    else:
        play_url = play_path

    video_resp = requests.get(
        play_url,
        headers={
            "User-Agent": DESKTOP_USER_AGENT,
            "Referer": "https://www.tikwm.com/",
        },
        timeout=60,
        stream=True,
    )
    video_resp.raise_for_status()

    out_path = Path(temp_dir) / "video.mp4"
    with open(out_path, "wb") as fh:
        for chunk in video_resp.iter_content(chunk_size=1 << 16):
            if chunk:
                fh.write(chunk)

    if not out_path.exists() or out_path.stat().st_size == 0:
        raise RuntimeError("tikwm fallback produced empty file")

    return out_path


def _download_tiktok_video(video_url: str):
    temp_dir = tempfile.mkdtemp(prefix="tiktok_video_")
    canonical_url = _resolve_short_url(video_url)

    errors = []

    try:
        path = _download_via_ytdlp(canonical_url, temp_dir)
        return path, temp_dir
    except Exception as exc:
        errors.append(f"yt-dlp: {exc}")
        print(f"[Gemini Vision] yt-dlp failed, trying fallback. {exc}")

    try:
        path = _download_via_tikwm(canonical_url, temp_dir)
        return path, temp_dir
    except Exception as exc:
        errors.append(f"tikwm: {exc}")
        print(f"[Gemini Vision] tikwm fallback failed. {exc}")

    shutil.rmtree(temp_dir, ignore_errors=True)
    raise RuntimeError(
        "Could not download TikTok video. Tried: " + " | ".join(errors)
    )


def _response_text(response) -> str:
    """Extract text from a Gemini response, handling thought_signature parts."""

    text = getattr(response, "text", None)
    if text:
        return text

    chunks = []
    for candidate in getattr(response, "candidates", None) or []:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", None) or []:
            value = getattr(part, "text", None)
            if value:
                chunks.append(value)

    return "".join(chunks)


def _upload_video_to_gemini(video_path: Path):
    mime_type = mimetypes.guess_type(video_path.name)[0] or "video/mp4"

    uploaded_file = gemini_client.files.upload(
        file=str(video_path),
        config=types.UploadFileConfig(mime_type=mime_type),
    )

    for _ in range(60):
        current = gemini_client.files.get(name=uploaded_file.name)
        state = getattr(current, "state", None)
        state_name = getattr(state, "name", str(state))

        if state_name == "ACTIVE":
            return current

        if state_name == "FAILED":
            raise RuntimeError("Gemini video processing failed")

        time.sleep(1)

    raise TimeoutError("Gemini video processing timed out")


def analyze_tiktok_video_context(video_url: str, comments=None) -> dict:
    """
    Use Gemini Flash vision to understand the TikTok video and return context
    for emotion prediction.
    """

    if not _gemini_ready():
        return _fallback_context(comments)

    temp_dir = None
    uploaded_file = None

    try:
        video_path, temp_dir = _download_tiktok_video(video_url)

        # Cache the file so the frontend /video proxy can stream it back
        # without TikTok CDN's 403 referer block.
        vid = _video_id_from_url(video_url)
        if vid:
            try:
                shutil.copy2(video_path, VIDEO_CACHE_DIR / f"{vid}.mp4")
            except Exception as cache_exc:
                print(f"[Gemini Vision] cache copy failed: {cache_exc}")

        uploaded_file = _upload_video_to_gemini(video_path)

        sample_comments = "\n".join((comments or [])[:20])
        prompt = _build_video_context_prompt(sample_comments)

        response = gemini_client.models.generate_content(
            model=GEMINI_VISION_MODEL,
            contents=[prompt, uploaded_file],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
            ),
        )

        data = _extract_json(_response_text(response))
        if not data:
            print("[Gemini Vision] empty/invalid JSON, falling back")
            return _fallback_context(comments)

        tone = str(data.get("tone", "neutral")).lower().strip()
        if tone not in ALLOWED_TONE_SET:
            tone = "neutral"

        raw_scores = data.get("scores")
        normalized_scores = {t: 0 for t in ALLOWED_TONES}
        if isinstance(raw_scores, dict):
            for key, value in raw_scores.items():
                k = str(key).lower().strip()
                if k in ALLOWED_TONE_SET:
                    try:
                        normalized_scores[k] = max(0, min(100, int(round(float(value)))))
                    except (TypeError, ValueError):
                        continue
        if sum(normalized_scores.values()) == 0:
            normalized_scores[tone] = 100
        else:
            top_tone = max(ALLOWED_TONES, key=lambda key: normalized_scores[key])
            if normalized_scores[top_tone] > normalized_scores[tone]:
                tone = top_tone

        raw_keywords = data.get("keywords")
        keywords = []
        if isinstance(raw_keywords, list):
            keywords = [str(k).strip() for k in raw_keywords if str(k).strip()][:8]

        return {
            "topic": str(data.get("topic") or "Khong xac dinh").strip(),
            "tone": tone,
            "scores": normalized_scores,
            "visual_summary": str(data.get("visual_summary") or "").strip(),
            "audience_context": str(data.get("audience_context") or "").strip(),
            "keywords": keywords,
            "source": "gemini_flash_vision",
        }

    except Exception as exc:
        import traceback
        print(f"[Gemini Vision Error] {type(exc).__name__}: {exc}")
        traceback.print_exc()
        context = _fallback_context(comments)
        context["source"] = "local_fallback"
        context["error"] = f"{type(exc).__name__}: {exc}"
        return context

    finally:
        if uploaded_file is not None:
            try:
                gemini_client.files.delete(name=uploaded_file.name)
            except Exception:
                pass

        if temp_dir:
            shutil.rmtree(temp_dir, ignore_errors=True)


def _local_emotion_report(summary: dict, emotions: dict, video_context=None) -> str:
    pos = summary.get("positive", 0)
    neu = summary.get("neutral", 0)
    neg = summary.get("negative", 0)
    total = max(pos + neu + neg, 1)

    pos_ratio = pos / total
    neg_ratio = neg / total

    if pos_ratio >= 0.65:
        trend = "rat tich cuc"
    elif pos_ratio >= 0.5:
        trend = "tich cuc"
    elif neg_ratio >= 0.55:
        trend = "tieu cuc manh"
    elif neg_ratio >= 0.4:
        trend = "kha tieu cuc"
    else:
        trend = "phan hoa / trung lap"

    dominant_emotion = max(emotions, key=emotions.get) if emotions else "OTHER"
    context_text = ""

    if isinstance(video_context, dict):
        context_text = (
            video_context.get("visual_summary")
            or video_context.get("audience_context")
            or video_context.get("topic")
            or ""
        )

    return f"""
TONG QUAN CAM XUC

Video dang co xu huong {trend}.

Positive: {pos} comments
Neutral: {neu} comments
Negative: {neg} comments

Cam xuc noi bat: {dominant_emotion}
Ngu canh video: {context_text}

Ty le phan hoi tieu cuc: {round(neg_ratio * 100, 1)}%

De xuat: tiep tuc theo doi cac nhom binh luan noi bat va dieu chinh noi dung theo phan ung cua nguoi xem.
""".strip()


def analyze_video_context(
    summary: dict,
    emotions: dict,
    video_context=None,
    comments=None,
) -> str:
    """
    Use Gemini to write an analyst report about viewer emotions.
    """

    if not _gemini_ready():
        return _local_emotion_report(summary, emotions, video_context)

    try:
        sample_comments = "\n".join((comments or [])[:30])
        prompt = _build_emotion_analyst_prompt(
            summary=summary,
            emotions=emotions,
            video_context=video_context,
            sample_comments=sample_comments,
        )

        response = gemini_client.models.generate_content(
            model=GEMINI_ANALYST_MODEL,
            contents=prompt,
        )

        text = _response_text(response).strip()
        if text:
            return text

    except Exception as exc:
        print(f"[Gemini Analyst Error] {exc}")

    return _local_emotion_report(summary, emotions, video_context)
