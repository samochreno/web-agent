from __future__ import annotations

from datetime import timedelta
from typing import Dict, List

from .google import GoogleCalendarService
from .models import CalendarCache, GoogleConnection, SessionData
from .utils import now


class CalendarVisibilityService:
    CALENDAR_LIST_TTL_MINUTES = 30
    VISIBLE_SELECTION_TTL_DAYS = 7

    def __init__(self, calendar_service: GoogleCalendarService) -> None:
        self.calendar_service = calendar_service

    def available_calendars(
        self, connection: GoogleConnection, session: SessionData
    ) -> List[Dict[str, object]]:
        cache: CalendarCache = session.calendar_cache
        if cache.available and cache.available_expires_at and cache.available_expires_at > now():
            return cache.available

        calendars = [
            self._with_readonly_flag(calendar)
            for calendar in self.calendar_service.list_calendars(connection, session)
            if self._supports_events(calendar.get("access_role"))
        ]

        cache.available = calendars
        cache.available_expires_at = now() + timedelta(minutes=self.CALENDAR_LIST_TTL_MINUTES)
        session.calendar_cache = cache
        return calendars

    def refresh_calendars(
        self, connection: GoogleConnection, session: SessionData
    ) -> List[Dict[str, object]]:
        session.calendar_cache.available = []
        session.calendar_cache.available_expires_at = None
        return self.available_calendars(connection, session)

    def visible_calendars(
        self, connection: GoogleConnection, session: SessionData
    ) -> List[Dict[str, object]]:
        available = self.available_calendars(connection, session)
        visible_ids = self._visible_calendar_ids(session, available)
        return [calendar for calendar in available if calendar["id"] in visible_ids]

    def update_visible_calendars(
        self, connection: GoogleConnection, session: SessionData, calendar_ids: List[str]
    ) -> List[Dict[str, object]]:
        available = self.available_calendars(connection, session)
        allowed_ids = {calendar["id"] for calendar in available}
        filtered = [cid for cid in calendar_ids if cid in allowed_ids]

        session.calendar_cache.visible_ids = list(dict.fromkeys(filtered))
        session.calendar_cache.visible_expires_at = now() + timedelta(
            days=self.VISIBLE_SELECTION_TTL_DAYS
        )

        return self.visible_calendars(connection, session)

    def is_readonly(self, connection: GoogleConnection, session: SessionData, calendar_id: str) -> bool:
        calendar = next(
            (calendar for calendar in self.available_calendars(connection, session) if calendar["id"] == calendar_id),
            None,
        )
        if not calendar:
            return True
        return self.is_readonly_access(calendar.get("access_role"))

    def is_readonly_access(self, access_role: str | None) -> bool:
        return access_role not in {"owner", "writer"}

    def _visible_calendar_ids(self, session: SessionData, available: List[Dict[str, object]]) -> List[str]:
        cache: CalendarCache = session.calendar_cache
        if cache.visible_ids and cache.visible_expires_at and cache.visible_expires_at > now():
            normalized = [cid for cid in cache.visible_ids if any(c["id"] == cid for c in available)]
            if normalized:
                return normalized

        defaults = self._default_visible_ids(available)
        session.calendar_cache.visible_ids = defaults
        session.calendar_cache.visible_expires_at = now() + timedelta(
            days=self.VISIBLE_SELECTION_TTL_DAYS
        )
        return defaults

    def _default_visible_ids(self, available: List[Dict[str, object]]) -> List[str]:
        primary = next((calendar for calendar in available if calendar.get("primary")), None)
        if primary:
            return [primary["id"]]
        return []

    def _supports_events(self, access_role: str | None) -> bool:
        return access_role in {"owner", "writer", "reader"}

    def _with_readonly_flag(self, calendar: Dict[str, object]) -> Dict[str, object]:
        calendar["readonly"] = self.is_readonly_access(calendar.get("access_role"))  # type: ignore[arg-type]
        return calendar
