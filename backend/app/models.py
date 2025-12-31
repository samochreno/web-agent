from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional


@dataclass
class UserProfile:
    id: str
    email: str
    name: Optional[str] = None


@dataclass
class GoogleConnection:
    email: str
    access_token: str
    refresh_token: Optional[str] = None
    token_type: Optional[str] = None
    scope: Optional[str] = None
    expires_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


@dataclass
class CalendarCache:
    available: List[Dict[str, Any]] = field(default_factory=list)
    available_expires_at: Optional[datetime] = None
    visible_ids: List[str] = field(default_factory=list)
    visible_expires_at: Optional[datetime] = None


@dataclass
class TaskListCache:
    task_lists: List[Dict[str, Any]] = field(default_factory=list)
    expires_at: Optional[datetime] = None


@dataclass
class SessionData:
    user: Optional[UserProfile] = None
    google: Optional[GoogleConnection] = None
    alias_state: Dict[str, Any] = field(
        default_factory=lambda: {"counter": 0, "aliases": {}, "reverse": {}}
    )
    calendar_cache: CalendarCache = field(default_factory=CalendarCache)
    task_lists_cache: TaskListCache = field(default_factory=TaskListCache)
    oauth_state: Optional[str] = None
    conversation: List[Dict[str, Any]] = field(default_factory=list)
