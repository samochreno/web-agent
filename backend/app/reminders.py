from __future__ import annotations

import uuid
from typing import Any, Dict, List, Mapping, Optional

from .alias import AliasService
from .config import timezone
from .google import GoogleTasksService
from .models import GoogleConnection, SessionData, TriggerReminder
from .persistent_reminder_store import PersistentReminderStore
from .reminder_serialization import serialize_reminder
from .utils import now

VALID_TRIGGERS = {"enter_car", "exit_car"}


class ReminderService:
    """Persistent reminder coordinator keyed by the owning session or user ID."""

    def __init__(self, tasks: GoogleTasksService, store: PersistentReminderStore) -> None:
        self.tasks = tasks
        self.store = store

    def schedule(self, session_id: str, session: SessionData, arguments: Mapping[str, Any]) -> Dict[str, Any]:
        text = self._require_string(arguments.get("text") or arguments.get("title"))
        trigger_type = self._require_trigger(arguments.get("trigger_type") or arguments.get("trigger"))

        reminder = TriggerReminder(
            id=str(uuid.uuid4()),
            text=text,
            trigger_type=trigger_type,
            status="pending",
            created_at=now(),
        )
        owner = self._owner_key(session_id, session)
        self.store.append(owner, reminder)
        return {"reminder": serialize_reminder(reminder)}

    def list(self, session_id: str, session: SessionData) -> Dict[str, Any]:
        owner = self._owner_key(session_id, session)
        reminders = self.store.all(owner)
        return {"reminders": [serialize_reminder(reminder) for reminder in reminders]}

    def fire(
        self,
        session_id: str,
        session: SessionData,
        trigger_type: str,
        connection: Optional[GoogleConnection],
        alias: AliasService,
    ) -> Dict[str, Any]:
        normalized_trigger = self._require_trigger(trigger_type)
        owner = self._owner_key(session_id, session)
        triggered = self.store.mutate(
            owner,
            lambda reminders: self._trigger_reminders(reminders, normalized_trigger, connection, session, alias),
        )

        return {
            "trigger_type": normalized_trigger,
            "reminders": [serialize_reminder(item) for item in triggered],
        }

    def _create_google_task(
        self,
        connection: Optional[GoogleConnection],
        session: SessionData,
        alias: AliasService,
        reminder: TriggerReminder,
    ) -> tuple[Optional[str], Optional[str], Optional[str]]:
        if not connection:
            raise RuntimeError("Google is not connected; task creation skipped.")

        task_list_id = self._default_task_list_id(connection, session, alias)
        if not task_list_id:
            raise RuntimeError("No Google task lists are available.")

        due_today = now().astimezone(timezone()).replace(
            hour=9,
            minute=0,
            second=0,
            microsecond=0,
        )
        notes = f"Triggered when you {reminder.trigger_type.replace('_', ' ')}."
        created = self.tasks.create_task(
            connection,
            session,
            task_list_id,
            reminder.text,
            notes,
            due_today,
        )
        task_alias = alias.register_task(task_list_id, created.get("id"))
        return created.get("id"), task_alias, task_list_id

    def _default_task_list_id(
        self, connection: GoogleConnection, session: SessionData, alias: AliasService
    ) -> Optional[str]:
        cached = session.task_lists_cache.task_lists
        if cached:
            alias.register_task_list(cached[0]["id"])
            return cached[0]["id"]

        lists = self.tasks.prefetch_task_lists(connection, session)
        if lists:
            alias.register_task_list(lists[0]["id"])
            return lists[0]["id"]
        return None

    def _trigger_reminders(
        self,
        reminders: List[TriggerReminder],
        normalized_trigger: str,
        connection: Optional[GoogleConnection],
        session: SessionData,
        alias: AliasService,
    ) -> List[TriggerReminder]:
        triggered: List[TriggerReminder] = []
        for reminder in reminders:
            if reminder.trigger_type != normalized_trigger or reminder.status != "pending":
                continue
            reminder.status = "fired"
            reminder.fired_at = now()
            try:
                task_id, task_alias, task_list_id = self._create_google_task(connection, session, alias, reminder)
                reminder.google_task_id = task_id
                reminder.google_task_alias = task_alias
                reminder.task_list_id = task_list_id
                reminder.task_error = None
            except Exception as exc:  # noqa: BLE001
                reminder.task_error = str(exc)
            triggered.append(reminder)
        return triggered

    def _require_string(self, value: Any) -> str:
        if isinstance(value, str) and value.strip():
            return value.strip()
        raise ValueError("Reminder text is required.")

    def _require_trigger(self, raw: Any) -> str:
        if isinstance(raw, str) and raw.strip():
            normalized = raw.strip().lower().replace(" ", "_")
            if normalized in {"enter", "entering_car", "in_car"}:
                normalized = "enter_car"
            if normalized in {"exit", "leaving_car", "out_car", "out_of_car"}:
                normalized = "exit_car"
            if normalized in VALID_TRIGGERS:
                return normalized
        raise ValueError(f"Invalid trigger_type. Supported: {', '.join(sorted(VALID_TRIGGERS))}")

    def _owner_key(self, session_id: str, session: SessionData) -> str:
        if session.user and session.user.id:
            return session.user.id
        return session_id
