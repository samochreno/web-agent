from __future__ import annotations

from typing import Any, Dict, Iterable, List


class AliasService:
    """Masks Google resource identifiers to keep raw IDs hidden from the model and UI."""

    def __init__(self, state: Dict[str, Any]) -> None:
        self._state = state

    def reset(self) -> None:
        self._state.clear()
        self._state.update({"counter": 0, "aliases": {}, "reverse": {}})

    def register_calendar(self, calendar_id: str, access_role: str | None = None) -> str:
        return self._register(
            {"type": "calendar", "calendar_id": calendar_id, "access_role": access_role}
        )

    def register_task_list(self, task_list_id: str) -> str:
        return self._register({"type": "task_list", "task_list_id": task_list_id})

    def register_task(self, task_list_id: str, task_id: str) -> str:
        return self._register(
            {"type": "task", "task_list_id": task_list_id, "task_id": task_id}
        )

    def register_event(
        self, event_id: str, calendar_id: str = "primary", readonly: bool = False
    ) -> str:
        return self._register(
            {
                "type": "event",
                "event_id": event_id,
                "calendar_id": calendar_id,
                "readonly": readonly,
            }
        )

    def resolve_calendar(self, alias_or_real: str) -> str:
        payload = self._payload(alias_or_real)
        if payload and payload.get("type") == "calendar":
            return payload.get("calendar_id", alias_or_real)
        return alias_or_real

    def resolve_task_list(self, alias_or_real: str) -> str:
        payload = self._payload(alias_or_real)
        if payload and payload.get("type") == "task_list":
            return payload.get("task_list_id", alias_or_real)
        return alias_or_real

    def resolve_task(self, task_list_alias: str, task_alias: str) -> tuple[str, str]:
        task_list_id = self.resolve_task_list(task_list_alias)
        payload = self._payload(task_alias)
        if payload and payload.get("type") == "task":
            return payload.get("task_list_id", task_list_id), payload.get("task_id", task_alias)
        return task_list_id, task_alias

    def resolve_event(self, alias_or_real: str, default_calendar: str = "primary") -> tuple[str, str]:
        payload = self._payload(alias_or_real)
        if payload and payload.get("type") == "event":
            return payload.get("calendar_id", default_calendar), payload.get("event_id", alias_or_real)
        return default_calendar, alias_or_real

    def mask_calendars(self, calendars: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [self.mask_calendar(calendar) for calendar in calendars]

    def mask_calendar(self, calendar: Dict[str, Any]) -> Dict[str, Any]:
        alias = self.register_calendar(calendar["id"], calendar.get("access_role"))
        masked = {k: v for k, v in calendar.items() if k not in {"id", "calendar_id"}}
        masked["id"] = alias
        return masked

    def mask_task_lists(self, lists: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [
            {"id": self.register_task_list(item["id"]), "title": item.get("title") or item.get("name")}
            for item in lists
        ]

    def mask_tasks(self, tasks: Iterable[Dict[str, Any]], task_list_id: str) -> List[Dict[str, Any]]:
        return [self.mask_task(task, task_list_id) for task in tasks]

    def mask_task(self, task: Dict[str, Any], task_list_id: str) -> Dict[str, Any]:
        alias = self.register_task(task_list_id, task["id"])
        masked = {k: v for k, v in task.items() if k != "id"}
        masked["id"] = alias
        return masked

    def mask_events(
        self, events: Iterable[Dict[str, Any]], calendar_id: str | None = None
    ) -> List[Dict[str, Any]]:
        masked: List[Dict[str, Any]] = []
        for event in events:
            target_calendar = event.get("calendar_id") or calendar_id or "primary"
            masked.append(self.mask_event(event, target_calendar))
        return masked

    def mask_event(self, event: Dict[str, Any], calendar_id: str = "primary") -> Dict[str, Any]:
        readonly = bool(event.get("readonly", False))
        alias = self.register_event(event["id"], calendar_id, readonly)
        masked = {k: v for k, v in event.items() if k not in {"id", "calendar_id"}}
        masked["id"] = alias
        masked["readonly"] = readonly
        return masked

    def event_is_readonly(self, event_alias: str) -> bool:
        payload = self._payload(event_alias)
        return bool(payload.get("readonly")) if payload and payload.get("type") == "event" else False

    def _payload(self, alias: str) -> Dict[str, Any] | None:
        aliases = self._state.get("aliases", {})
        return aliases.get(alias)

    def _register(self, payload: Dict[str, Any]) -> str:
        reverse = self._state.setdefault("reverse", {})
        key = self._payload_key(payload)
        if key in reverse:
            return reverse[key]

        counter = int(self._state.get("counter", 0)) + 1
        alias = str(counter)
        self._state["counter"] = counter
        aliases = self._state.setdefault("aliases", {})
        aliases[alias] = payload
        reverse[key] = alias
        return alias

    def _payload_key(self, payload: Dict[str, Any]) -> str:
        key_payload = dict(payload)
        if key_payload.get("type") == "event":
            key_payload.pop("readonly", None)
        if key_payload.get("type") == "calendar":
            key_payload.pop("access_role", None)
        return repr(sorted(key_payload.items()))
