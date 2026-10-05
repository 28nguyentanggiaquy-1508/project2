import os
from pathlib import Path

from dotenv import load_dotenv


BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env")

MODEL_PATH = "model/phobert"
DICT_PATH = "assets/dic_final_cleaned.json"
MAX_SEQ_LEN = 256
BATCH_SIZE = 8
GEMINI_API_KEY = (
    os.getenv("GEMINI_API_KEY")
    or os.getenv("GOOGLE_API_KEY")
    or ""
)
GEMINI_VISION_MODEL = os.getenv("GEMINI_VISION_MODEL", "gemini-3-flash-preview")
GEMINI_ANALYST_MODEL = os.getenv("GEMINI_ANALYST_MODEL", "gemini-3-flash-preview")

# ============================================================
# FACT-CHECKING V2 - PHASE 1 -> 4
# ============================================================

# External web search provider used only to collect candidate evidence.
# This is an engineering adaptation for the TikTok project, not a
# component prescribed by MOCHEG.
GOOGLE_SEARCH_API_KEY = os.getenv("GOOGLE_SEARCH_API_KEY", "")
GOOGLE_SEARCH_CX = os.getenv("GOOGLE_SEARCH_CX", "")

# Text / image retrieval models.
TEXT_RETRIEVAL_MODEL = os.getenv(
    "TEXT_RETRIEVAL_MODEL",
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
)
IMAGE_RETRIEVAL_MODEL = os.getenv(
    "IMAGE_RETRIEVAL_MODEL",
    "openai/clip-vit-base-patch32",
)

# Retrieval limits.
WEB_SEARCH_MAX_RESULTS = int(os.getenv("WEB_SEARCH_MAX_RESULTS", "10"))
TEXT_RETRIEVAL_TOP_N = int(os.getenv("TEXT_RETRIEVAL_TOP_N", "20"))
IMAGE_RETRIEVAL_TOP_N = int(os.getenv("IMAGE_RETRIEVAL_TOP_N", "10"))
TEXT_EVIDENCE_TOP_K = int(os.getenv("TEXT_EVIDENCE_TOP_K", "5"))
IMAGE_EVIDENCE_TOP_K = int(os.getenv("IMAGE_EVIDENCE_TOP_K", "3"))

# Bound the number of claims extracted from one short-form video to
# control latency / search quota during the prototype stage.
MAX_CHECK_WORTHY_CLAIMS = int(os.getenv("MAX_CHECK_WORTHY_CLAIMS", "5"))

# HTTP safeguards for evidence acquisition.
EVIDENCE_REQUEST_TIMEOUT = float(os.getenv("EVIDENCE_REQUEST_TIMEOUT", "10"))
EVIDENCE_MAX_PAGE_BYTES = int(os.getenv("EVIDENCE_MAX_PAGE_BYTES", "2000000"))
EVIDENCE_MAX_IMAGE_BYTES = int(os.getenv("EVIDENCE_MAX_IMAGE_BYTES", "8000000"))

# CoReS-inspired concept filtering.
# These are project defaults, NOT thresholds reported by the CoReS paper.
CONCEPT_CLUSTER_THRESHOLD = float(
    os.getenv("CONCEPT_CLUSTER_THRESHOLD", "0.86")
)
CONCEPT_CLAIM_THRESHOLD = float(
    os.getenv("CONCEPT_CLAIM_THRESHOLD", "0.40")
)
CONCEPT_MIN_FREQ_RATIO = float(
    os.getenv("CONCEPT_MIN_FREQ_RATIO", "0.20")
)


# ============================================================
# PHASE 4 - MULTIMODAL CLAIM VERIFICATION
# ============================================================

# Maximum retrieved image evidence items attached to the VLM verifier.
VERIFICATION_MAX_IMAGES = int(os.getenv("VERIFICATION_MAX_IMAGES", "3"))

# Maximum text length from each evidence item included in the verification prompt.
VERIFICATION_MAX_EVIDENCE_CHARS = int(
    os.getenv("VERIFICATION_MAX_EVIDENCE_CHARS", "1800")
)
GEMINI_MAX_RETRIES = int(
    os.getenv("GEMINI_MAX_RETRIES", "4")
)

GEMINI_RETRY_BASE_SECONDS = float(
    os.getenv("GEMINI_RETRY_BASE_SECONDS", "2")
)

GEMINI_FALLBACK_MODEL = os.getenv(
    "GEMINI_FALLBACK_MODEL",
    "gemini-3.7-flash",
)