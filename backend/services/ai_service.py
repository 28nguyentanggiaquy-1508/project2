from core.crawler import get_all_comments
from core.gemini_vision import (
    analyze_tiktok_video_context,
    analyze_video_context,
)
from core.model_manager import model_manager

from core.comment_filter import filter_comments_by_context
from core.context_refiner import refine_prediction
# load model 1 lần duy nhất
try:
    import emoji
except Exception:
    emoji = None


def preprocess_crawled_comments(comments):
    processed = []

    for comment in comments:
        text = str(comment.get("text", ""))

        if "[Sticker]" in text:
            continue

        if emoji:
            text = emoji.demojize(text, language="en")

        item = dict(comment)
        item["text"] = text
        processed.append(item)

    return processed


async def analyze_video(url, model_id=None):
    try:
        # =========================================================
        # 1. CRAWL COMMENTS
        # =========================================================
        comments, video_id = get_all_comments(url, 50)
        comments = preprocess_crawled_comments(comments)

        if not comments:
            return {
                "error": "Không lấy được comment"
            }

        # =========================================================
        # 2. EXTRACT RAW TEXT
        # =========================================================
        raw_texts = [
            c["text"]
            for c in comments
            if c.get("text")
        ]

        # =========================================================
        # 3. VIDEO CONTEXT BY GEMINI FLASH VISION
        # =========================================================
        video_context = analyze_tiktok_video_context(
            url,
            comments=raw_texts
        )

        # =========================================================
        # 4. FILTER COMMENTS BY CONTEXT
        # =========================================================
        comments = filter_comments_by_context(
            comments,
            video_context
        )

        if not comments:
            return {
                "error": "Comments bị filter hết"
            }

        # =========================================================
        # 5. PREPARE TEXTS
        # =========================================================
        texts = [
            c["text"]
            for c in comments
        ]

        # =========================================================
        # 6. PREDICT
        # =========================================================
        engine = model_manager.get(model_id)
        preds = engine.predict_batch(texts, video_context=video_context)

        # Context-aware relabeling
        refined_preds = []

        for i, pred in enumerate(preds):

            refined = refine_prediction(
                comments[i]["text"],
                pred,
                video_context
            )

            refined_preds.append(refined)

        preds = refined_preds

        # =========================================================
        # 7. SUMMARY
        # =========================================================
        pos = sum(
            1 for p in preds
            if p["label"] == "ENJOYMENT"
        )

        neu = sum(
            1 for p in preds
            if p["label"] == "OTHER"
        )

        neg = sum(
            1 for p in preds
            if p["label"] in [
                "ANGER",
                "SADNESS",
                "FEAR",
                "DISGUST"
            ]
        )

        # =========================================================
        # 8. EMOTION STATS
        # =========================================================
        emotions_count = {
            label: 0
            for label in [
                "ANGER",
                "DISGUST",
                "ENJOYMENT",
                "FEAR",
                "OTHER",
                "SADNESS",
                "SURPRISE"
            ]
        }

        for p in preds:
            for lb in p["all_labels"]:
                if lb in emotions_count:
                    emotions_count[lb] += 1

        # =========================================================
        # 9. AI INSIGHT
        # =========================================================
        insight = analyze_video_context(
            summary={
                "positive": pos,
                "neutral": neu,
                "negative": neg
            },
            emotions=emotions_count,
            video_context=video_context,
            comments=texts
        )

        # =========================================================
        # 10. RETURN
        # =========================================================
        return {
            "video_id": video_id,
            "video_url": url,
            "model_id": model_id,

            # context
            "context": video_context,

            # dashboard
            "summary": {
                "positive": pos,
                "neutral": neu,
                "negative": neg,
            },

            # emotion chart
            "emotions": emotions_count,

            # AI report
            "insight": insight,

            # labeled comments
            "comments": [
                {
                    "text": comments[i]["text"],
                    "label": preds[i]["label"],
                    "all_labels": preds[i]["all_labels"],
                    "confidence": round(
                        preds[i]["confidence"],
                        4
                    ),
                    "probabilities": {
                        k: round(float(v), 4)
                        for k, v in (preds[i].get("probabilities") or {}).items()
                    },
                }
                for i in range(len(preds))
            ]
        }

    except Exception as e:
        print(f"[AI SERVICE ERROR] {e}")

        return {
            "error": str(e)
        }
