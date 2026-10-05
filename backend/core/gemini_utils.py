from __future__ import annotations

import random
import time
from typing import Any

from config import (
    GEMINI_FALLBACK_MODEL,
    GEMINI_MAX_RETRIES,
    GEMINI_RETRY_BASE_SECONDS,
)


RETRYABLE_STATUS_CODES = {
    429,
    500,
    502,
    503,
    504,
}


def _get_status_code(exc: Exception) -> int | None:
    """
    Lấy HTTP status code từ exception của google-genai.
    """

    for attr in ("status_code", "code"):
        value = getattr(exc, attr, None)

        try:
            if value is not None:
                return int(value)
        except (TypeError, ValueError):
            pass

    # Fallback khi version google-genai không expose status_code
    text = str(exc)

    for code in RETRYABLE_STATUS_CODES:
        if str(code) in text:
            return code

    return None


def _is_retryable(exc: Exception) -> bool:
    """
    Chỉ retry lỗi server/rate-limit/tạm thời.
    """

    status_code = _get_status_code(exc)

    if status_code in RETRYABLE_STATUS_CODES:
        return True

    text = str(exc).lower()

    keywords = (
        "unavailable",
        "high demand",
        "resource exhausted",
        "rate limit",
        "temporarily unavailable",
        "timeout",
    )

    return any(
        keyword in text
        for keyword in keywords
    )


def generate_content_with_retry(
    client,
    *,
    model: str,
    contents: Any,
    config=None,
):
    """
    Wrapper an toàn cho Gemini generate_content.

    Quy tắc:
    - thành công -> return (response, model_used)
    - lỗi 429/5xx -> retry exponential backoff
    - hết retry model chính -> thử fallback model
    - tất cả thất bại -> raise exception

    Hàm này KHÔNG BAO GIỜ return None.
    """

    if client is None:
        raise RuntimeError(
            "Gemini client chưa được khởi tạo. "
            "Kiểm tra GEMINI_API_KEY."
        )

    primary_model = (model or "").strip()

    if not primary_model:
        raise ValueError(
            "Gemini model không được để trống."
        )

    models_to_try = [primary_model]

    fallback_model = (
        GEMINI_FALLBACK_MODEL or ""
    ).strip()

    if (
        fallback_model
        and fallback_model != primary_model
    ):
        models_to_try.append(
            fallback_model
        )

    last_error: Exception | None = None

    for current_model in models_to_try:

        print(
            f"[Gemini] Trying model={current_model}"
        )

        for attempt in range(
            1,
            GEMINI_MAX_RETRIES + 1,
        ):
            try:
                response = (
                    client.models.generate_content(
                        model=current_model,
                        contents=contents,
                        config=config,
                    )
                )

                if response is None:
                    raise RuntimeError(
                        "Gemini returned None response."
                    )

                print(
                    "[Gemini] Success "
                    f"model={current_model} "
                    f"attempt={attempt}"
                )

                return response, current_model

            except Exception as exc:
                last_error = exc

                # Lỗi không retry được -> fail ngay
                if not _is_retryable(exc):
                    print(
                        "[Gemini] Non-retryable error: "
                        f"{type(exc).__name__}: {exc}"
                    )
                    raise

                # Đã hết retry của model hiện tại
                if attempt >= GEMINI_MAX_RETRIES:
                    print(
                        "[Gemini] Exhausted retries "
                        f"model={current_model}"
                    )
                    break

                wait_seconds = (
                    GEMINI_RETRY_BASE_SECONDS
                    * (2 ** (attempt - 1))
                    + random.uniform(0.0, 0.5)
                )

                print(
                    "[Gemini Retry] "
                    f"model={current_model} "
                    f"attempt={attempt}/"
                    f"{GEMINI_MAX_RETRIES} "
                    f"error={type(exc).__name__} "
                    f"wait={wait_seconds:.1f}s"
                )

                time.sleep(wait_seconds)

    # Không được return None ở đây
    if last_error is not None:
        raise last_error

    raise RuntimeError(
        "Gemini request failed without exception."
    )