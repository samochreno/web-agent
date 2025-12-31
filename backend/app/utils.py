from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Mapping
from zoneinfo import ZoneInfo

from .config import timezone as app_timezone

try:  # pragma: no cover - fallback when python-dateutil is unavailable
    from dateutil import parser  # type: ignore
except ImportError:  # pragma: no cover - fallback parser
    class _FallbackParser:
        @staticmethod
        def isoparse(value: str) -> datetime:
            return datetime.fromisoformat(value)

    parser = _FallbackParser()


def now() -> datetime:
    return datetime.now(app_timezone())


def parse_local_datetime(raw: str, tz: ZoneInfo | None = None) -> datetime:
    tzinfo = tz or app_timezone()
    dt = parser.isoparse(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=tzinfo)
    return dt.astimezone(tzinfo)


def parse_date_only(raw: str) -> datetime:
    dt = parser.isoparse(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)


def clean_dict(payload: Mapping[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in payload.items() if v is not None}


def clamp_future(dt: datetime, minutes: int) -> datetime:
    return dt + timedelta(minutes=minutes)
