# pylint: disable=too-few-public-methods
from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from threading import Lock
from typing import Any, Callable, Dict, List, Mapping, Optional, TypeVar

from .config import reminder_store_path
from .models import TriggerReminder
from .reminder_serialization import deserialize_reminder, serialize_reminder

T = TypeVar("T")
Mutator = Callable[[List[TriggerReminder]], T]


class PersistentReminderStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = Path(path or reminder_store_path())
        self._lock = Lock()
        self._data: Dict[str, List[TriggerReminder]] = {}
        self._load()

    def all(self, owner: str) -> List[TriggerReminder]:
        with self._lock:
            return [deepcopy(reminder) for reminder in self._data.get(owner, [])]

    def append(self, owner: str, reminder: TriggerReminder) -> None:
        with self._lock:
            self._data.setdefault(owner, []).append(reminder)
            self._persist()

    def mutate(self, owner: str, mutator: Mutator[T]) -> T:
        with self._lock:
            reminders = self._data.setdefault(owner, [])
            result = mutator(reminders)
            self._persist()
            return result

    def _load(self) -> None:
        if not self.path.exists():
            return
        try:
            payload = json.loads(self.path.read_text())
        except (json.JSONDecodeError, OSError):
            return

        owners = payload.get("owners")
        if not isinstance(owners, Mapping):
            return

        for owner, raw_items in owners.items():
            if not isinstance(owner, str):
                continue
            if not isinstance(raw_items, list):
                continue
            parsed: List[TriggerReminder] = []
            for raw in raw_items:
                if not isinstance(raw, Mapping):
                    continue
                reminder = self._decode(raw)
                if reminder:
                    parsed.append(reminder)
            if parsed:
                self._data[owner] = parsed

    def _persist(self) -> None:
        if not self.path.parent.exists():
            self.path.parent.mkdir(parents=True, exist_ok=True)

        payload: Dict[str, List[Dict[str, Any]]] = {"owners": {}}
        for owner, reminders in self._data.items():
            payload["owners"][owner] = [serialize_reminder(reminder) for reminder in reminders]

        self.path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def _decode(self, raw: Mapping[str, Any]) -> Optional[TriggerReminder]:
        try:
            return deserialize_reminder(raw)
        except Exception:
            return None
