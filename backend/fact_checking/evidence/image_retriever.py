from __future__ import annotations

from functools import lru_cache
from io import BytesIO
from urllib.parse import urlparse

import requests
import torch
import torch.nn.functional as F
from PIL import Image, UnidentifiedImageError
from transformers import CLIPModel, CLIPProcessor

from config import (
    EVIDENCE_MAX_IMAGE_BYTES,
    EVIDENCE_REQUEST_TIMEOUT,
    GOOGLE_SEARCH_API_KEY,
    GOOGLE_SEARCH_CX,
    IMAGE_RETRIEVAL_MODEL,
    IMAGE_RETRIEVAL_TOP_N,
)
from fact_checking.evidence.evidence_schema import EvidenceItem
from fact_checking.evidence.http_utils import read_limited_bytes, safe_get


SEARCH_ENDPOINT = "https://www.googleapis.com/customsearch/v1"

Image.MAX_IMAGE_PIXELS = 30_000_000


def _unit_score(cosine_score: float) -> float:
    return max(0.0, min(1.0, (float(cosine_score) + 1.0) / 2.0))


class ImageEncoder:
    """
    CLIP baseline matching the retrieval design used by MOCHEG.

    Note: the default OpenAI CLIP text encoder is strongest in English.
    The model path remains configurable so a Vietnamese/multilingual
    CLIP-compatible replacement can be evaluated later.
    """

    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

        self.processor = CLIPProcessor.from_pretrained(
            IMAGE_RETRIEVAL_MODEL
        )
        self.model = CLIPModel.from_pretrained(
            IMAGE_RETRIEVAL_MODEL
        ).to(self.device).eval()

    def encode_text(self, text: str) -> torch.Tensor:
        inputs = self.processor(
            text=[text],
            return_tensors="pt",
            padding=True,
            truncation=True,
        )
        inputs = {
            key: value.to(self.device)
            for key, value in inputs.items()
        }

        with torch.no_grad():
            features = self.model.get_text_features(**inputs)

        return F.normalize(features, p=2, dim=-1).cpu()

    def encode_image(self, image: Image.Image) -> torch.Tensor:
        inputs = self.processor(
            images=image,
            return_tensors="pt",
        )
        inputs = {
            key: value.to(self.device)
            for key, value in inputs.items()
        }

        with torch.no_grad():
            features = self.model.get_image_features(**inputs)

        return F.normalize(features, p=2, dim=-1).cpu()


@lru_cache(maxsize=1)
def get_image_encoder() -> ImageEncoder:
    return ImageEncoder()


def _google_image_search(
    query: str,
    max_results: int,
) -> list[dict]:
    if not GOOGLE_SEARCH_API_KEY or not GOOGLE_SEARCH_CX:
        return []

    max_results = max(1, min(max_results, 10))

    response = requests.get(
        SEARCH_ENDPOINT,
        params={
            "key": GOOGLE_SEARCH_API_KEY,
            "cx": GOOGLE_SEARCH_CX,
            "q": query,
            "searchType": "image",
            "num": max_results,
            "safe": "active",
        },
        timeout=EVIDENCE_REQUEST_TIMEOUT,
    )
    response.raise_for_status()

    return response.json().get("items", [])


def load_remote_image(url: str) -> Image.Image | None:
    try:
        response = safe_get(
            url,
            timeout=EVIDENCE_REQUEST_TIMEOUT,
            headers={"User-Agent": "Mozilla/5.0"},
            stream=True,
        )
        response.raise_for_status()

        content_type = response.headers.get("content-type", "").lower()

        if content_type and not content_type.startswith("image/"):
            response.close()
            return None

        raw = read_limited_bytes(
            response,
            EVIDENCE_MAX_IMAGE_BYTES,
        )
        response.close()

        image = Image.open(BytesIO(raw))
        image.load()
        image = image.convert("RGB")

        # Control memory usage before CLIP preprocessing.
        image.thumbnail((2048, 2048))

        return image

    except (UnidentifiedImageError, OSError, ValueError, requests.RequestException):
        return None


def retrieve_image_evidence(
    claim: str,
    top_n: int | None = None,
) -> list[EvidenceItem]:
    top_n = top_n or IMAGE_RETRIEVAL_TOP_N

    search_results = _google_image_search(
        claim,
        max_results=min(max(top_n, 1), 10),
    )

    if not search_results:
        return []

    encoder = get_image_encoder()
    text_embedding = encoder.encode_text(claim)

    evidence = []

    for index, result in enumerate(search_results, start=1):
        image_url = str(result.get("link") or "").strip()
        image_info = result.get("image") or {}
        source_url = str(image_info.get("contextLink") or "").strip()

        image = load_remote_image(image_url)

        if image is None:
            continue

        image_embedding = encoder.encode_image(image)
        raw_cosine = torch.mm(
            image_embedding,
            text_embedding.T,
        ).item()
        score = _unit_score(raw_cosine)

        evidence.append(
            EvidenceItem(
                id=f"image_{index:02d}",
                modality="image",
                title=str(result.get("title") or "").strip(),
                source_url=source_url or image_url,
                source_domain=(urlparse(source_url or image_url).hostname or "").lower(),
                content=str(result.get("snippet") or "").strip(),
                media_url=image_url,
                retrieval_score=score,
                relevance_score=score,
                metadata={
                    "retrieval_method": "clip_cosine",
                    "raw_cosine": round(float(raw_cosine), 6),
                },
            )
        )

    evidence.sort(
        key=lambda item: item.retrieval_score,
        reverse=True,
    )

    return evidence[:top_n]