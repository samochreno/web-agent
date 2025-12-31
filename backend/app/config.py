"""Configuration helpers for the Managed ChatKit backend."""

from __future__ import annotations

import os
from functools import lru_cache
from typing import List
from zoneinfo import ZoneInfo

DEFAULT_CHATKIT_BASE = "https://api.openai.com"
SESSION_COOKIE_NAME = "chatkit_session_id"
SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30  # 30 days


@lru_cache(maxsize=1)
def timezone() -> ZoneInfo:
    tz = os.getenv("APP_TIMEZONE", "UTC")
    try:
        return ZoneInfo(tz)
    except Exception:
        return ZoneInfo("UTC")


def chatkit_api_base() -> str:
    return (
        os.getenv("CHATKIT_API_BASE")
        or os.getenv("VITE_CHATKIT_API_BASE")
        or DEFAULT_CHATKIT_BASE
    )


def workflow_id() -> str | None:
    env_value = os.getenv("CHATKIT_WORKFLOW_ID") or os.getenv(
        "VITE_CHATKIT_WORKFLOW_ID"
    )
    if env_value and env_value.strip():
        return env_value.strip()
    return None


def workflow_version() -> str | None:
    raw = os.getenv("CHATKIT_WORKFLOW_VERSION")
    if raw and raw.strip():
        return raw.strip()
    return None


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


def google_redirect_uri() -> str:
    return os.getenv("GOOGLE_REDIRECT_URI", "http://127.0.0.1:8000/api/google/callback")


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


def frontend_base_url() -> str:
    return os.getenv("FRONTEND_BASE_URL", "http://127.0.0.1:3000")


def is_prod() -> bool:
    env = (os.getenv("ENVIRONMENT") or os.getenv("NODE_ENV") or "").lower()
    return env == "production"
