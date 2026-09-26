import requests
import re

def extract_video_id(url):
    match = re.search(r"/video/(\d+)", url)
    return match.group(1) if match else None


def get_all_comments(url, max_comments=20):
    video_id = extract_video_id(url)

    if not video_id:
        return [], None

    comments = []

    try:
        api_url = f"https://www.tiktok.com/api/comment/list/?aid=1988&aweme_id={video_id}&count={max_comments}"

        headers = {
            "User-Agent": "Mozilla/5.0"
        }

        res = requests.get(api_url, headers=headers)
        data = res.json()

        if "comments" not in data:
            return [], video_id

        for c in data["comments"]:
            comments.append({
                "text": c["text"]
            })

    except Exception as e:
        print("Crawler error:", e)

    return comments, video_id