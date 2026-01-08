from __future__ import annotations

from dataclasses import asdict
from datetime import datetime
from typing import Any, Dict, Mapping, Optional

from .models import TriggerReminder
from .utils import now


def serialize_reminder(reminder: TriggerReminder) -> Dict[str, Any]:
    payload = asdict(reminder)
    for key in ("created_at", "fired_at"):
        value = payload.get(key)
        if isinstance(value, datetime):
            payload[key] = value.isoformat()
    return payload


def deserialize_reminder(raw: Mapping[str, Any]) -> TriggerReminder:
    created_at = _parse_datetime(raw.get("created_at")) or now()
    fired_at = _parse_datetime(raw.get("fired_at"))
    return TriggerReminder(
        id=_coerce_string(raw.get("id")) or _coerce_string(raw.get("uid")) or "",
        text=_coerce_string(raw.get("text")) or "",
        trigger_type=_coerce_string(raw.get("trigger_type")) or "",
        status=_coerce_string(raw.get("status")) or "pending",
        created_at=created_at,
        fired_at=fired_at,
        google_task_id=_coerce_string(raw.get("google_task_id")),
        google_task_alias=_coerce_string(raw.get("google_task_alias")),
        task_list_id=_coerce_string(raw.get("task_list_id")),
        task_error=_coerce_string(raw.get("task_error")),
    )


def _parse_datetime(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
    return None


def _coerce_string(value: Any) -> Optional[str]:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if value is None:
        return None
    return str(value)
