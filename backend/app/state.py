from __future__ import annotations

import json
from typing import Any, Dict

from . import config
from .google import GoogleTasksService
from .models import GoogleConnection, SessionData
from .utils import now


class ChatKitStateService:
    def __init__(self, tasks_service: GoogleTasksService) -> None:
        self.tasks_service = tasks_service

    def variables(self, connection: GoogleConnection | None, session: SessionData) -> Dict[str, Any]:
        current = now()
        tasklists: list[dict[str, Any]] = []

        if connection:
            try:
                tasklists = self.tasks_service.cached_task_lists(session)
                if not tasklists:
                    tasklists = self.tasks_service.prefetch_task_lists(connection, session)
            except Exception:
                tasklists = []

        return {
            "date": current.date().isoformat(),
            "time": current.strftime("%H:%M"),
            "day": current.strftime("%A"),
            "tasklists": self._encode_task_lists(tasklists),
        }

    def _encode_task_lists(self, task_lists: list[dict[str, Any]]) -> str | None:
        normalized = []
        for task in task_lists:
            tid = task.get("id")
            name = task.get("name") or task.get("title")
            if tid and name:
                normalized.append({"id": tid, "name": name})
        if not normalized:
            return None
        return json.dumps(normalized)
