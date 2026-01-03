from __future__ import annotations

from datetime import datetime, timedelta
import uuid
from typing import Any, Dict, Iterable, List, Optional, Tuple, TYPE_CHECKING, NamedTuple

from . import config
from .models import CalendarCache, GoogleConnection, SessionData, TaskListCache
from .utils import now, parse_local_datetime, parser

if TYPE_CHECKING:  # pragma: no cover
    from google.oauth2.credentials import Credentials  # type: ignore
    from google_auth_oauthlib.flow import Flow  # type: ignore
    from google.auth.transport.requests import Request  # type: ignore


class GoogleNotConfigured(Exception):
    pass


class _GoogleModules(NamedTuple):
    build: Any
    credentials: Any
    flow: Any
    request: Any


_GOOGLE_MODULES: _GoogleModules | None = None


def _google_modules() -> _GoogleModules:
    global _GOOGLE_MODULES
    if _GOOGLE_MODULES is not None:
        return _GOOGLE_MODULES

    try:
        from googleapiclient.discovery import build as _build  # type: ignore
        from google.oauth2.credentials import Credentials as _Credentials  # type: ignore
        from google_auth_oauthlib.flow import Flow as _Flow  # type: ignore
        from google.auth.transport.requests import Request as _Request  # type: ignore
    except ImportError as exc:  # pragma: no cover - import guard
        raise GoogleNotConfigured(
            "Google client libraries are not installed. Install google-api-python-client, google-auth, and google-auth-oauthlib."
        ) from exc

    _GOOGLE_MODULES = _GoogleModules(
        build=_build,
        credentials=_Credentials,
        flow=_Flow,
        request=_Request,
    )
    return _GOOGLE_MODULES


def ensure_google_configured() -> None:
    if not config.google_client_id() or not config.google_client_secret():
        raise GoogleNotConfigured("Google OAuth is not configured.")


def build_flow(state: str) -> Flow:
    ensure_google_configured()
    Flow = _google_modules().flow
    return Flow.from_client_config(
        {
            "web": {
                "client_id": config.google_client_id(),
                "client_secret": config.google_client_secret(),
                "redirect_uris": [config.google_redirect_uri()],
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        scopes=config.google_scopes(),
        redirect_uri=config.google_redirect_uri(),
        state=state,
    )


def authorization_url(session: SessionData) -> str:
    ensure_google_configured()
    state = str(uuid.uuid4())
    session.oauth_state = state
    flow = build_flow(state)
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    return auth_url


def handle_oauth_callback(session: SessionData, code: str, state: str) -> GoogleConnection:
    ensure_google_configured()
    if session.oauth_state and session.oauth_state != state:
        raise ValueError("Invalid OAuth state")

    flow = build_flow(state)
    flow.fetch_token(code=code)
    creds = flow.credentials
    email = _lookup_email(creds)
    token_response = getattr(creds, "token_response", None) or {}
    connection = GoogleConnection(
        email=email or "Google user",
        access_token=creds.token,
        refresh_token=creds.refresh_token,
        token_type=token_response.get("token_type"),
        scope=token_response.get("scope"),
        expires_at=creds.expiry,
        created_at=now(),
    )
    session.google = connection
    session.oauth_state = None
    session.calendar_cache = CalendarCache()
    session.task_lists_cache = TaskListCache()
    return connection


def disconnect(session: SessionData) -> None:
    session.google = None
    session.calendar_cache = CalendarCache()
    session.task_lists_cache = TaskListCache()
    session.oauth_state = None


def _lookup_email(credentials: Credentials) -> str | None:
    try:
        modules = _google_modules()
        service = modules.build("oauth2", "v2", credentials=credentials, cache_discovery=False)
        profile = service.userinfo().get().execute()
        return profile.get("email")
    except Exception:
        return None


def credentials_for(connection: GoogleConnection, session: SessionData) -> Credentials:
    modules = _google_modules()
    creds = modules.credentials(
        token=connection.access_token,
        refresh_token=connection.refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=config.google_client_id(),
        client_secret=config.google_client_secret(),
        scopes=config.google_scopes(),
    )

    if creds.expired and creds.refresh_token:
        creds.refresh(modules.request())
        connection.access_token = creds.token
        connection.expires_at = creds.expiry
        connection.scope = " ".join(creds.scopes) if creds.scopes else connection.scope
        session.google = connection

    return creds


def map_task(task: Dict[str, Any], tz) -> Dict[str, Any]:
    due = task.get("due")
    parsed = parser.isoparse(due) if due else None
    normalized_due = parsed.astimezone(tz).date().isoformat() if parsed else None
    return {
        "id": task.get("id"),
        "title": task.get("title"),
        "notes": task.get("notes"),
        "status": task.get("status"),
        "due": normalized_due,
    }


def map_event(event: Dict[str, Any], calendar_id: Optional[str] = None) -> Dict[str, Any]:
    start = event.get("start") or {}
    end = event.get("end") or {}
    start_at = start.get("dateTime") or start.get("date")
    end_at = end.get("dateTime") or end.get("date")
    return {
        "id": event.get("id"),
        "summary": event.get("summary"),
        "description": event.get("description"),
        "location": event.get("location"),
        "start": start_at,
        "end": end_at,
        "calendar_id": calendar_id,
    }


class GoogleTasksService:
    TASKLIST_CACHE_MINUTES = 60

    def list_task_lists(self, connection: GoogleConnection, session: SessionData) -> List[Dict[str, Any]]:
        modules = _google_modules()
        service = modules.build("tasks", "v1", credentials=credentials_for(connection, session), cache_discovery=False)
        response = service.tasklists().list().execute()
        items = response.get("items") or []
        return [{"id": item.get("id"), "title": item.get("title"), "name": item.get("title")} for item in items]

    def cached_task_lists(self, session: SessionData) -> List[Dict[str, Any]]:
        cache = session.task_lists_cache
        if cache.task_lists and cache.expires_at and cache.expires_at > now():
            return cache.task_lists
        return []

    def prefetch_task_lists(
        self, connection: GoogleConnection, session: SessionData
    ) -> List[Dict[str, Any]]:
        lists = self.list_task_lists(connection, session)
        session.task_lists_cache.task_lists = lists
        session.task_lists_cache.expires_at = now() + timedelta(minutes=self.TASKLIST_CACHE_MINUTES)
        return lists

    def list_tasks(
        self,
        connection: GoogleConnection,
        session: SessionData,
        task_list_id: str,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
    ) -> List[Dict[str, Any]]:
        modules = _google_modules()
        service = modules.build("tasks", "v1", credentials=credentials_for(connection, session), cache_discovery=False)
        response = service.tasks().list(tasklist=task_list_id, showCompleted=True, showHidden=False).execute()
        timezone = config.timezone()
        tasks = [map_task(item, timezone) for item in response.get("items") or []]
        if not start or not end:
            return tasks

        window_start = start.replace(hour=0, minute=0, second=0, microsecond=0)
        window_end = end.replace(hour=23, minute=59, second=59, microsecond=0)
        filtered: List[Dict[str, Any]] = []
        for task in tasks:
            if not task.get("due"):
                continue
            try:
                due_date = parse_local_datetime(task["due"], timezone)
            except Exception:
                continue
            if window_start <= due_date <= window_end:
                filtered.append(task)
        return filtered

    def create_task(
        self,
        connection: GoogleConnection,
        session: SessionData,
        task_list_id: str,
        title: str,
        notes: Optional[str],
        due: Optional[datetime],
    ) -> Dict[str, Any]:
        modules = _google_modules()
        service = modules.build("tasks", "v1", credentials=credentials_for(connection, session), cache_discovery=False)
        body: Dict[str, Any] = {"title": title}
        if notes is not None:
            body["notes"] = notes
        if due:
            body["due"] = due.astimezone().isoformat()
        created = service.tasks().insert(tasklist=task_list_id, body=body).execute()
        return map_task(created, config.timezone())

    def update_task(
        self,
        connection: GoogleConnection,
        session: SessionData,
        task_list_id: str,
        task_id: str,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        modules = _google_modules()
        service = modules.build("tasks", "v1", credentials=credentials_for(connection, session), cache_discovery=False)
        body: Dict[str, Any] = {}
        if "title" in payload:
            body["title"] = payload["title"]
        if "notes" in payload:
            body["notes"] = payload["notes"]
        if "due" in payload:
            due_value = payload["due"]
            if isinstance(due_value, datetime):
                body["due"] = due_value.astimezone().isoformat()
            elif due_value is None:
                body["due"] = None
        if "status" in payload:
            body["status"] = payload["status"]

        updated = service.tasks().patch(tasklist=task_list_id, task=task_id, body=body).execute()
        return map_task(updated, config.timezone())


class GoogleCalendarService:
    def list_events(
        self,
        connection: GoogleConnection,
        session: SessionData,
        calendar_id: str,
        start: datetime,
        end: datetime,
    ) -> List[Dict[str, Any]]:
        modules = _google_modules()
        service = modules.build("calendar", "v3", credentials=credentials_for(connection, session), cache_discovery=False)
        response = (
            service.events()
            .list(
                calendarId=calendar_id,
                timeMin=start.isoformat(),
                timeMax=end.isoformat(),
                singleEvents=True,
                orderBy="startTime",
            )
            .execute()
        )
        items = response.get("items") or []
        events: List[Dict[str, Any]] = []
        for item in items:
            if self._is_auto_generated_task_event(item):
                continue
            events.append(map_event(item, calendar_id))
        return events

    def create_event(
        self,
        connection: GoogleConnection,
        session: SessionData,
        calendar_id: str,
        summary: str,
        description: Optional[str],
        start: datetime,
        end: datetime,
        location: Optional[str] = None,
    ) -> Dict[str, Any]:
        modules = _google_modules()
        service = modules.build("calendar", "v3", credentials=credentials_for(connection, session), cache_discovery=False)
        payload: Dict[str, Any] = {
            "summary": summary,
            "description": description,
            "location": location,
            "start": self._event_date(start),
            "end": self._event_date(end),
        }
        created = service.events().insert(calendarId=calendar_id, body=payload).execute()
        return map_event(created, calendar_id)

    def update_event(
        self,
        connection: GoogleConnection,
        session: SessionData,
        calendar_id: str,
        event_id: str,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        modules = _google_modules()
        service = modules.build("calendar", "v3", credentials=credentials_for(connection, session), cache_discovery=False)
        existing = service.events().get(calendarId=calendar_id, eventId=event_id).execute()
        body = existing

        if "summary" in payload and payload["summary"]:
            body["summary"] = payload["summary"]
        if "description" in payload and payload["description"]:
            body["description"] = payload["description"]
        if "location" in payload and payload["location"]:
            body["location"] = payload["location"]
        if "start" in payload and isinstance(payload["start"], datetime):
            body["start"] = self._event_date(payload["start"])
        if "end" in payload and isinstance(payload["end"], datetime):
            body["end"] = self._event_date(payload["end"])

        updated = service.events().update(calendarId=calendar_id, eventId=event_id, body=body).execute()
        return map_event(updated, calendar_id)

    def list_calendars(self, connection: GoogleConnection, session: SessionData) -> List[Dict[str, Any]]:
        modules = _google_modules()
        service = modules.build("calendar", "v3", credentials=credentials_for(connection, session), cache_discovery=False)
        response = service.calendarList().list().execute()
        calendars = response.get("items") or []
        mapped: List[Dict[str, Any]] = []
        for calendar in calendars:
            is_primary = bool(calendar.get("primary"))
            mapped.append(
                {
                    "id": "primary" if is_primary else calendar.get("id"),
                    "name": calendar.get("summary"),
                    "primary": is_primary,
                    "access_role": calendar.get("accessRole"),
                }
            )
        return mapped

    def _is_auto_generated_task_event(self, event: Dict[str, Any]) -> bool:
        description = event.get("description")
        return isinstance(description, str) and "https://tasks.google.com/task" in description

    def _event_date(self, dt: datetime) -> Dict[str, Any]:
        return {"dateTime": dt.isoformat(), "timeZone": config.timezone().key}
