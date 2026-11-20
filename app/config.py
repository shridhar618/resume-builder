import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


class Config:
    # A fixed SECRET_KEY must be set in production, otherwise sessions reset on every restart.
    SECRET_KEY = os.environ.get("SECRET_KEY") or secrets.token_hex(32)
    DATABASE = os.environ.get("DATABASE_PATH", str(BASE_DIR / "instance" / "resume_builder.db"))

    # Session cookie hardening
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = os.environ.get("SESSION_COOKIE_SECURE", "false").lower() == "true"
    PERMANENT_SESSION_LIFETIME = 60 * 60 * 24 * 7  # 7 days
    MAX_CONTENT_LENGTH = 512 * 1024  # 512 KB request cap

    # AI provider: "gemini", "openai", "anthropic", or "offline" (rule-based, no key needed)
    AI_PROVIDER = os.environ.get("AI_PROVIDER", "").lower()
    GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
    GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")
    OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
    OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-5-mini")
    ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
    ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-5-5")
    AI_TIMEOUT = int(os.environ.get("AI_TIMEOUT", "30"))
    AI_REQUESTS_PER_HOUR = int(os.environ.get("AI_REQUESTS_PER_HOUR", "60"))

    # Login brute-force protection
    LOGIN_MAX_ATTEMPTS = 5
    LOGIN_WINDOW_SECONDS = 15 * 60

    TESTING = False
