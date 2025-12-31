from __future__ import annotations

import uuid
from typing import Dict, Tuple

from .models import SessionData


class SessionStore:
    """Simple in-memory session store keyed by the cookie session id."""

    def __init__(self) -> None:
        self._sessions: Dict[str, SessionData] = {}

    def ensure(self, session_id: str | None) -> Tuple[str, SessionData]:
        if session_id and session_id in self._sessions:
            return session_id, self._sessions[session_id]

        new_id = session_id or str(uuid.uuid4())
        data = self._sessions.setdefault(new_id, SessionData())
        return new_id, data

    def reset_aliases(self, session_id: str) -> None:
        if session_id not in self._sessions:
            return
        self._sessions[session_id].alias_state = {"counter": 0, "aliases": {}, "reverse": {}}

    def clear(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)
