"""Configuration helpers for the Realtime voice assistant backend."""

from __future__ import annotations

import os
from functools import lru_cache
from typing import List
from zoneinfo import ZoneInfo

DEFAULT_REALTIME_BASE = "https://api.openai.com"
SESSION_COOKIE_NAME = "realtime_session_id"
SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30  # 30 days


@lru_cache(maxsize=1)
def timezone() -> ZoneInfo:
    tz = os.getenv("APP_TIMEZONE", "UTC")
    try:
        return ZoneInfo(tz)
    except Exception:
        return ZoneInfo("UTC")


def realtime_api_base() -> str:
    return (
        os.getenv("REALTIME_API_BASE")
        or os.getenv("VITE_REALTIME_API_BASE")
        or DEFAULT_REALTIME_BASE
    )


def realtime_prompt_id() -> str | None:
    env_value = os.getenv("REALTIME_PROMPT_ID") or os.getenv("VITE_REALTIME_PROMPT_ID")
    if env_value and env_value.strip():
        return env_value.strip()
    return None


def realtime_model() -> str:
    raw = os.getenv("REALTIME_MODEL") or os.getenv("VITE_REALTIME_MODEL")
    if raw and raw.strip():
        return raw.strip()
    return "gpt-4o-realtime-preview-2025-06-03"


def realtime_voice() -> str:
    raw = os.getenv("REALTIME_VOICE") or os.getenv("VITE_REALTIME_VOICE")
    if raw and raw.strip():
        return raw.strip()
    return "alloy"


def organization() -> str | None:
    raw = os.getenv("OPENAI_ORGANIZATION") or os.getenv("OPENAI_ORG")
    if not raw:
        return None

    normalized = raw.strip()
    if normalized.startswith("org_") or normalized.startswith("org-"):
        return normalized
    return None


def google_client_id() -> str | None:
    raw = os.getenv("GOOGLE_CLIENT_ID")
    return raw.strip() if raw and raw.strip() else None


def google_client_secret() -> str | None:
    raw = os.getenv("GOOGLE_CLIENT_SECRET")
    return raw.strip() if raw and raw.strip() else None


def google_redirect_uri(fallback: str | None = None) -> str:
    env_value = os.getenv("GOOGLE_REDIRECT_URI")
    if env_value and env_value.strip():
        return env_value.rstrip("/")
    if fallback and fallback.strip():
        return fallback.rstrip("/")
    return "http://127.0.0.1:8000/api/google/callback"


def google_scopes() -> List[str]:
    raw = os.getenv("GOOGLE_SCOPES")
    if raw and raw.strip():
        return [scope.strip() for scope in raw.split(",") if scope.strip()]

    return [
        "https://www.googleapis.com/auth/tasks",
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/calendar.events",
    ]


def google_default_start_time() -> str:
    return os.getenv("GOOGLE_EVENT_START_TIME", "09:00")


def google_default_duration_minutes() -> int:
    raw = os.getenv("GOOGLE_EVENT_DURATION_MINUTES")
    try:
        return int(raw) if raw else 60
    except (TypeError, ValueError):
        return 60


def frontend_url(fallback: str | None = None) -> str:
    """Resolve the frontend base URL (allows overriding via env var or request info)."""
    env_value = os.getenv("FRONTEND_URL")
    if env_value and env_value.strip():
        return env_value.rstrip("/")
    if fallback and fallback.strip():
        return fallback.rstrip("/")
    return "http://127.0.0.1:3000"


def frontend_settings_path() -> str:
    """Path or hash fragment to the settings screen. Defaults to hash router '/#/settings'."""
    raw = os.getenv("FRONTEND_SETTINGS_PATH")
    if raw and raw.strip():
        return raw.strip()
    return "#/settings"


def is_prod() -> bool:
    env = (os.getenv("ENVIRONMENT") or os.getenv("NODE_ENV") or "").lower()
    return env == "production"
