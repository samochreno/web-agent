from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Mapping, Optional

from .alias import AliasService
from .calendar_visibility import CalendarVisibilityService
from .config import google_default_duration_minutes, timezone
from .google import GoogleCalendarService, GoogleConnection, GoogleTasksService
from .scheduling import resolve_event_window
from .utils import parse_date_only, parse_local_datetime


class ToolExecutor:
    def __init__(
        self,
        tasks: GoogleTasksService,
        calendars: GoogleCalendarService,
        visibility: CalendarVisibilityService,
    ) -> None:
        self.tasks = tasks
        self.calendars = calendars
        self.visibility = visibility

    def execute(
        self,
        name: str,
        arguments: Mapping[str, Any],
        connection: Optional[GoogleConnection],
        alias: AliasService,
        session,
    ) -> Dict[str, Any]:
        if not connection:
            raise RuntimeError("Google is not connected.")

        match name:
            case "list_task_lists":
                return {"data": alias.mask_task_lists(self.tasks.list_task_lists(connection, session))}
            case "list_tasks":
                task_list_id = self._resolve_task_list_id(connection, session, alias, arguments.get("task_list_id"))
                start = parse_local_datetime(arguments["start_date"], timezone()) if arguments.get("start_date") else None
                end = parse_local_datetime(arguments["end_date"], timezone()) if arguments.get("end_date") else None
                data = self.tasks.list_tasks(connection, session, task_list_id, start, end)
                return {
                    "task_list_id": alias.register_task_list(task_list_id),
                    "data": alias.mask_tasks(data, task_list_id),
                }
            case "create_task":
                return self._create_task(connection, session, alias, arguments)
            case "update_task":
                return self._update_task(connection, session, alias, arguments)
            case "list_events":
                return self._list_events(connection, session, alias, arguments)
            case "create_event":
                return self._create_event(connection, session, alias, arguments)
            case "update_event":
                return self._update_event(connection, session, alias, arguments)
            case _:
                return {"error": f"Unknown tool {name}"}

    def _create_task(
        self,
        connection: GoogleConnection,
        session,
        alias: AliasService,
        arguments: Mapping[str, Any],
    ) -> Dict[str, Any]:
        task_list_id = self._resolve_task_list_id(connection, session, alias, arguments.get("task_list_id"))
        due = self._resolve_due_date(arguments.get("due_date"))
        task = self.tasks.create_task(
            connection,
            session,
            task_list_id,
            arguments["title"],
            arguments.get("notes"),
            due,
        )
        return {
            "task_list_id": alias.register_task_list(task_list_id),
            "created": alias.mask_task(task, task_list_id),
        }

    def _update_task(
        self,
        connection: GoogleConnection,
        session,
        alias: AliasService,
        arguments: Mapping[str, Any],
    ) -> Dict[str, Any]:
        task_list_alias = arguments.get("task_list_id")
        task_list_id = self._resolve_task_list_id(connection, session, alias, task_list_alias)
        task_id_alias = arguments.get("task_id")
        if not task_id_alias:
            raise ValueError("task_id is required")

        task_list_id, task_id = alias.resolve_task(task_list_id, task_id_alias)
        payload: Dict[str, Any] = {}

        for field in ("title", "notes"):
            if field in arguments and arguments[field] not in (None, ""):
                payload[field] = arguments[field]

        if "due_date" in arguments:
            due_value = arguments.get("due_date")
            payload["due"] = self._resolve_updated_due_date(due_value)

        if "status" in arguments and arguments["status"] not in (None, ""):
            payload["status"] = arguments["status"]

        task = self.tasks.update_task(connection, session, task_list_id, task_id, payload)
        return {
            "task_list_id": alias.register_task_list(task_list_id),
            "task_id": alias.register_task(task_list_id, task["id"]),
            "updated": alias.mask_task(task, task_list_id),
        }

    def _list_events(
        self,
        connection: GoogleConnection,
        session,
        alias: AliasService,
        arguments: Mapping[str, Any],
    ) -> Dict[str, Any]:
        if not arguments.get("start_date") or not arguments.get("end_date"):
            raise ValueError("start_date and end_date are required")

        start = parse_local_datetime(arguments["start_date"], timezone())
        end = parse_local_datetime(arguments["end_date"], timezone()).replace(
            hour=23, minute=59, second=59, microsecond=0
        )

        try:
            calendars = self.visibility.visible_calendars(connection, session)
        except Exception:
            calendars = []

        if not calendars:
            calendars = [
                {
                    "id": "primary",
                    "name": "Primary calendar",
                    "primary": True,
                    "access_role": "owner",
                    "readonly": False,
                }
            ]

        events: List[Dict[str, Any]] = []
        for calendar in calendars:
            calendar_id = calendar.get("id", "primary")
            readonly = bool(
                calendar.get("readonly")
                or self.visibility.is_readonly_access(calendar.get("access_role"))  # type: ignore[arg-type]
            )
            try:
                calendar_events = self.calendars.list_events(connection, session, calendar_id, start, end)
            except Exception:
                continue

            for event in calendar_events:
                event["calendar_id"] = calendar_id
                event["calendar"] = calendar.get("name") or "Calendar"
                event["readonly"] = readonly or event.get("readonly", False)
                events.append(event)

        ordered = sorted(events, key=lambda e: self._event_start_timestamp(e))
        return {"events": alias.mask_events(ordered)}

    def _create_event(
        self,
        connection: GoogleConnection,
        session,
        alias: AliasService,
        arguments: Mapping[str, Any],
    ) -> Dict[str, Any]:
        summary = self._argument(arguments, "summary", "title", "name")
        if not summary:
            raise ValueError("Event summary/title is required.")

        start_dt = self._argument(arguments, "start_datetime", "startDateTime", "start")
        end_dt = self._argument(arguments, "end_datetime", "endDateTime", "end")
        description = arguments.get("notes") or arguments.get("description")
        location = arguments.get("location")

        if start_dt or end_dt:
            start = self._parse_datetime_or_fail(start_dt, "start_datetime")
            end = self._parse_datetime_or_fail(end_dt, "end_datetime") if end_dt else start + timedelta(
                minutes=google_default_duration_minutes()
            )
        else:
            start, end = resolve_event_window(
                arguments.get("date"),
                arguments.get("start_time"),
                arguments.get("end_time"),
            )

        event = self.calendars.create_event(
            connection,
            session,
            "primary",
            summary,
            description,
            start,
            end,
            location,
        )
        return {"event": alias.mask_event(event, "primary")}

    def _update_event(
        self,
        connection: GoogleConnection,
        session,
        alias: AliasService,
        arguments: Mapping[str, Any],
    ) -> Dict[str, Any]:
        event_id = arguments.get("event_id")
        if not event_id:
            raise ValueError("event_id is required")

        calendar_id, resolved_event_id = alias.resolve_event(event_id)
        if alias.event_is_readonly(event_id) or self.visibility.is_readonly(connection, session, calendar_id):
            raise RuntimeError("Events from shared calendars are view-only.")

        payload: Dict[str, Any] = {}
        if arguments.get("title") not in (None, ""):
            payload["summary"] = arguments.get("title")
        if arguments.get("notes") not in (None, ""):
            payload["description"] = arguments.get("notes")
        if arguments.get("location") not in (None, ""):
            payload["location"] = arguments.get("location")
        if arguments.get("start_datetime") not in (None, ""):
            payload["start"] = self._parse_datetime_or_fail(arguments.get("start_datetime"), "start_datetime")
        if arguments.get("end_datetime") not in (None, ""):
            payload["end"] = self._parse_datetime_or_fail(arguments.get("end_datetime"), "end_datetime")

        event = self.calendars.update_event(connection, session, calendar_id, resolved_event_id, payload)
        return {"event": alias.mask_event(event, calendar_id)}

    def _argument(self, arguments: Mapping[str, Any], *keys: str) -> Any:
        for key in keys:
            if key not in arguments:
                continue
            value = arguments.get(key)
            if value not in (None, ""):
                return value
        return None

    def _resolve_due_date(self, value: Any) -> datetime | None:
        if value in (None, ""):
            return None
        return parse_date_only(str(value))

    def _resolve_updated_due_date(self, value: Any) -> datetime | None:
        if value in (None, ""):
            return None
        return parse_date_only(str(value))

    def _resolve_task_list_id(
        self,
        connection: GoogleConnection,
        session,
        alias: AliasService,
        task_list_id: Optional[str],
    ) -> str:
        if task_list_id:
            return alias.resolve_task_list(task_list_id)

        lists = self.tasks.list_task_lists(connection, session)
        if not lists:
            raise RuntimeError("No task lists are available for this account.")
        default_id = lists[0]["id"]
        alias.register_task_list(default_id)
        return default_id

    def _parse_datetime_or_fail(self, value: Any, field: str) -> datetime:
        if not value:
            raise ValueError(f"{field} is required when using explicit datetimes.")
        try:
            return parse_local_datetime(str(value), timezone())
        except Exception:
            raise ValueError(f"Invalid {field} value.") from None

    def _event_start_timestamp(self, event: Mapping[str, Any]) -> float:
        start = event.get("start")
        if not start:
            return 0
        try:
            return parse_local_datetime(str(start), timezone()).timestamp()
        except Exception:
            return 0
