from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Dict, Tuple, NamedTuple

from .models import SessionData


class StateEntry(NamedTuple):
    session_id: str
    expires_at: datetime
    native_scheme: str | None = None


class SessionStore:
    """Simple in-memory session store keyed by the cookie session id."""

    def __init__(self) -> None:
        self._sessions: Dict[str, SessionData] = {}
        self._state_index: Dict[str, StateEntry] = {}

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

    def remember_state(
        self, state: str, session_id: str, ttl_seconds: int = 900, native_scheme: str | None = None
    ) -> None:
        """Map an OAuth state token to a session id (helps when Safari drops cookies)."""
        self._state_index[state] = StateEntry(
            session_id=session_id,
            expires_at=datetime.utcnow() + timedelta(seconds=ttl_seconds),
            native_scheme=native_scheme,
        )

    def consume_state(self, state: str) -> Tuple[str | None, str | None]:
        """Returns (session_id, native_scheme) or (None, None) if not found/expired."""
        entry = self._state_index.pop(state, None)
        if not entry:
            return None, None
        if entry.expires_at < datetime.utcnow():
            return None, None
        return entry.session_id, entry.native_scheme

    def prune_states(self) -> None:
        now = datetime.utcnow()
        expired = [key for key, entry in self._state_index.items() if entry.expires_at < now]
        for key in expired:
            self._state_index.pop(key, None)
