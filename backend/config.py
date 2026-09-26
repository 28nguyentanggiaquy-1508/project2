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
