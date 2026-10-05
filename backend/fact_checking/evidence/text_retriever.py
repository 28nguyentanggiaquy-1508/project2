from __future__ import annotations

import re
from functools import lru_cache
from urllib.parse import urlparse

import requests
import torch
import torch.nn.functional as F
from bs4 import BeautifulSoup
from transformers import AutoModel, AutoTokenizer

from config import (
    EVIDENCE_MAX_PAGE_BYTES,
    EVIDENCE_REQUEST_TIMEOUT,
    GOOGLE_SEARCH_API_KEY,
    GOOGLE_SEARCH_CX,
    TEXT_RETRIEVAL_MODEL,
    TEXT_RETRIEVAL_TOP_N,
    WEB_SEARCH_MAX_RESULTS,
)
from fact_checking.evidence.evidence_schema import EvidenceItem
from fact_checking.evidence.http_utils import read_limited_bytes, safe_get


SEARCH_ENDPOINT = "https://www.googleapis.com/customsearch/v1"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


def _unit_score(cosine_score: float) -> float:
    return max(0.0, min(1.0, (float(cosine_score) + 1.0) / 2.0))


class TextEncoder:
    """
    Lightweight mean-pooled Transformer encoder.

    The default checkpoint is multilingual so Vietnamese claims can be
    compared with Vietnamese or English evidence candidates.
    """

    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

        self.tokenizer = AutoTokenizer.from_pretrained(
            TEXT_RETRIEVAL_MODEL
        )
        self.model = AutoModel.from_pretrained(
            TEXT_RETRIEVAL_MODEL
        ).to(self.device).eval()

    def encode(
        self,
        texts: list[str],
        batch_size: int = 32,
    ) -> torch.Tensor:
        if not texts:
            return torch.empty((0, 0), dtype=torch.float32)

        batches = []

        for start in range(0, len(texts), batch_size):
            batch_texts = texts[start:start + batch_size]

            encoded = self.tokenizer(
                batch_texts,
                padding=True,
                truncation=True,
                max_length=256,
                return_tensors="pt",
            )

            encoded = {
                key: value.to(self.device)
                for key, value in encoded.items()
            }

            with torch.no_grad():
                outputs = self.model(**encoded)

            hidden = outputs.last_hidden_state
            mask = (
                encoded["attention_mask"]
                .unsqueeze(-1)
                .expand(hidden.size())
                .float()
            )

            pooled = (
                (hidden * mask).sum(dim=1)
                / mask.sum(dim=1).clamp(min=1e-9)
            )

            pooled = F.normalize(pooled, p=2, dim=1)
            batches.append(pooled.cpu())

        return torch.cat(batches, dim=0)


@lru_cache(maxsize=1)
def get_text_encoder() -> TextEncoder:
    return TextEncoder()


def _google_web_search(
    query: str,
    max_results: int,
) -> list[dict]:
    """
    Candidate-source discovery layer.

    MOCHEG assumes a pre-collected corpus. The TikTok project instead uses
    a live search API to construct a small claim-specific candidate corpus.
    """
    if not GOOGLE_SEARCH_API_KEY or not GOOGLE_SEARCH_CX:
        return []

    max_results = max(1, min(max_results, 30))
    results: list[dict] = []
    start = 1

    while len(results) < max_results:
        num = min(10, max_results - len(results))

        response = requests.get(
            SEARCH_ENDPOINT,
            params={
                "key": GOOGLE_SEARCH_API_KEY,
                "cx": GOOGLE_SEARCH_CX,
                "q": query,
                "num": num,
                "start": start,
            },
            timeout=EVIDENCE_REQUEST_TIMEOUT,
        )
        response.raise_for_status()

        items = response.json().get("items", [])

        if not items:
            break

        results.extend(items)

        if len(items) < num:
            break

        start += num

        # Google Custom Search only exposes a bounded result window.
        if start > 91:
            break

    return results[:max_results]


def _clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _fetch_page_paragraphs(url: str) -> list[str]:
    try:
        response = safe_get(
            url,
            timeout=EVIDENCE_REQUEST_TIMEOUT,
            headers={"User-Agent": USER_AGENT},
            stream=True,
        )
        response.raise_for_status()

        content_type = response.headers.get("content-type", "").lower()

        if "text/html" not in content_type:
            response.close()
            return []

        raw = read_limited_bytes(
            response,
            EVIDENCE_MAX_PAGE_BYTES,
        )
        encoding = response.encoding or "utf-8"
        response.close()

        html = raw.decode(encoding, errors="replace")
        soup = BeautifulSoup(html, "html.parser")

        for tag in soup(["script", "style", "nav", "footer", "aside", "noscript"]):
            tag.decompose()

        paragraphs = []
        seen = set()

        for paragraph in soup.find_all("p"):
            text = _clean_text(paragraph.get_text(" "))

            if len(text) < 40:
                continue

            text = text[:1500]
            key = text.casefold()

            if key in seen:
                continue

            seen.add(key)
            paragraphs.append(text)

            if len(paragraphs) >= 60:
                break

        return paragraphs

    except Exception:
        return []


def _score_candidates(
    claim: str,
    texts: list[str],
) -> tuple[list[float], list[float]]:
    if not texts:
        return [], []

    encoder = get_text_encoder()
    embeddings = encoder.encode([claim] + texts)

    claim_embedding = embeddings[0:1]
    evidence_embeddings = embeddings[1:]

    raw_scores = torch.mm(
        evidence_embeddings,
        claim_embedding.T,
    ).squeeze(1)

    raw = [float(value) for value in raw_scores]
    normalized = [_unit_score(value) for value in raw]

    return raw, normalized


def retrieve_text_evidence(
    claim: str,
    top_n: int | None = None,
) -> list[EvidenceItem]:
    top_n = top_n or TEXT_RETRIEVAL_TOP_N

    search_results = _google_web_search(
        claim,
        max_results=WEB_SEARCH_MAX_RESULTS,
    )

    candidates = []
    seen_content = set()

    for source_rank, result in enumerate(search_results, start=1):
        source_url = str(result.get("link") or "").strip()
        title = _clean_text(str(result.get("title") or ""))
        snippet = _clean_text(str(result.get("snippet") or ""))

        paragraphs = _fetch_page_paragraphs(source_url)

        if not paragraphs and snippet:
            paragraphs = [snippet]

        domain = (urlparse(source_url).hostname or "").lower()

        for paragraph_index, paragraph in enumerate(paragraphs):
            key = paragraph.casefold()

            if key in seen_content:
                continue

            seen_content.add(key)

            candidates.append(
                {
                    "id": f"text_{source_rank:02d}_{paragraph_index:03d}",
                    "title": title,
                    "source_url": source_url,
                    "source_domain": domain,
                    "content": paragraph,
                    "source_rank": source_rank,
                    "paragraph_index": paragraph_index,
                }
            )

            # Keep prototype retrieval bounded.
            if len(candidates) >= 240:
                break

        if len(candidates) >= 240:
            break

    if not candidates:
        return []

    raw_scores, scores = _score_candidates(
        claim,
        [candidate["content"] for candidate in candidates],
    )

    evidence = []

    for candidate, raw_score, score in zip(
        candidates,
        raw_scores,
        scores,
    ):
        evidence.append(
            EvidenceItem(
                id=candidate["id"],
                modality="text",
                title=candidate["title"],
                source_url=candidate["source_url"],
                source_domain=candidate["source_domain"],
                content=candidate["content"],
                retrieval_score=score,
                relevance_score=score,
                metadata={
                    "retrieval_method": "multilingual_transformer_cosine",
                    "raw_cosine": round(raw_score, 6),
                    "source_rank": candidate["source_rank"],
                    "paragraph_index": candidate["paragraph_index"],
                },
            )
        )

    evidence.sort(
        key=lambda item: item.retrieval_score,
        reverse=True,
    )

    return evidence[:top_n]