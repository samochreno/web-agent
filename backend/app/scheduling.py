from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from .config import google_default_duration_minutes, google_default_start_time, timezone
from .utils import parse_local_datetime


def resolve_event_window(date: str | None, start: str | None, end: str | None) -> tuple[datetime, datetime]:
    tz = timezone()
    day_reference = date or datetime.now(tz).date().isoformat()
    if start:
        start_dt = parse_local_datetime(start, tz)
    else:
        hours, minutes = google_default_start_time().split(":")
        start_dt = datetime.fromisoformat(day_reference).replace(
            hour=int(hours), minute=int(minutes), tzinfo=tz
        )

    if end:
        end_dt = parse_local_datetime(end, tz)
    else:
        end_dt = start_dt + timedelta(minutes=google_default_duration_minutes())

    return start_dt, end_dt
