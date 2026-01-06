"""FastAPI entrypoint for Realtime sessions, tool calls, and Google connectivity."""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any, Mapping, Tuple
import logging

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from urllib.parse import urlparse

from . import config
from .alias import AliasService
from .calendar_visibility import CalendarVisibilityService
from .google import (
    GoogleCalendarService,
    GoogleNotConfigured,
    GoogleTasksService,
    authorization_url as build_google_auth_url,
    disconnect as disconnect_google,
    handle_oauth_callback,
)
from .models import SessionData, UserProfile
from .sessions import SessionStore
from .tools import ToolExecutor

app = FastAPI(title="Realtime Assistant API")
logger = logging.getLogger("uvicorn.error")

# Build metadata (optional env var for deployed SHA)
BUILD_HASH = os.getenv("BUILD_HASH", "unknown")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SESSION_STORE = SessionStore()
TASKS_SERVICE = GoogleTasksService()
CALENDAR_SERVICE = GoogleCalendarService()
VISIBILITY_SERVICE = CalendarVisibilityService(CALENDAR_SERVICE)
# Keep state service available for future per-session metadata if needed.
TOOL_EXECUTOR = ToolExecutor(TASKS_SERVICE, CALENDAR_SERVICE, VISIBILITY_SERVICE)
NON_GOOGLE_TOOLS = {"get_current_datetime", "web_search"}


@app.get("/health")
async def health() -> Mapping[str, str]:
    return {"status": "ok"}


@app.get("/api/auth/session")
async def auth_session(request: Request) -> JSONResponse:
    session_id, session, needs_cookie = ensure_session(request)
    payload = {
        "user": serialize_user(session.user),
        "google": serialize_google(session),
        "prompt": {"id": config.realtime_prompt_id()},
    }
    return respond(payload, 200, session_id if needs_cookie else None, needs_cookie)


@app.post("/api/auth/login")
async def login(request: Request) -> JSONResponse:
    session_id, session, needs_cookie = ensure_session(request)
    body = await read_json_body(request)
    email = read_string(body.get("email"))
    if not email:
        return respond({"error": "Email is required."}, 400, session_id if needs_cookie else None, needs_cookie)

    name = read_string(body.get("name"))
    user_id = session.user.id if session.user else str(uuid.uuid4())
    session.user = UserProfile(id=user_id, email=email, name=name)
    return respond({"user": serialize_user(session.user)}, 200, session_id if needs_cookie else None, needs_cookie)


@app.post("/api/auth/logout")
async def logout(request: Request) -> JSONResponse:
    session_id, session, needs_cookie = ensure_session(request)
    session.user = None
    disconnect_google(session)
    SESSION_STORE.reset_aliases(session_id)
    return respond({"ok": True}, 200, session_id if needs_cookie else None, needs_cookie)


@app.post("/api/realtime/session")
async def create_realtime_session(request: Request) -> JSONResponse:
    """Exchange a prompt id for a Realtime client secret and websocket URL."""
    api_key = read_string(os.getenv("OPENAI_API_KEY"))
    if not api_key:
        return respond({"error": "Missing OPENAI_API_KEY environment variable"}, 500)

    session_id, session, needs_cookie = ensure_session(request)
    body = await read_json_body(request)
    prompt_id = resolve_prompt_id(body)
    if not prompt_id:
        return respond({"error": "Missing prompt id"}, 400, session_id if needs_cookie else None, needs_cookie)

    api_base = config.realtime_api_base().rstrip("/")
    payload = {
        "modalities": ["text", "audio"],
        "prompt": {"id": prompt_id},
        "input_audio_transcription": {"model": "whisper-1"},
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "OpenAI-Beta": "realtime=v1",
    }
    organization = config.organization()
    if organization:
        headers["OpenAI-Organization"] = organization

    try:
        async with httpx.AsyncClient(base_url=api_base, timeout=10.0) as client:
            upstream = await client.post("/v1/realtime/sessions", headers=headers, json=payload)
    except httpx.RequestError as error:
        return respond(
            {"error": f"Failed to reach Realtime API: {error}"},
            502,
            session_id if needs_cookie else None,
            needs_cookie,
        )

    parsed = parse_json(upstream)
    if not upstream.is_success:
        message = parsed.get("error") if isinstance(parsed, Mapping) else None
        message = message or upstream.reason_phrase or "Failed to create session"
        return respond({"error": message}, upstream.status_code, session_id if needs_cookie else None, needs_cookie)

    client_secret = parsed.get("client_secret") if isinstance(parsed, Mapping) else None
    expires_after = parsed.get("expires_after") if isinstance(parsed, Mapping) else None
    ws_url = parsed.get("url") if isinstance(parsed, Mapping) else None
    if not client_secret or not isinstance(client_secret, Mapping) or "value" not in client_secret:
        return respond(
            {"error": "Missing client secret in response"},
            502,
            session_id if needs_cookie else None,
            needs_cookie,
        )

    SESSION_STORE.reset_aliases(session_id)
    return respond(
        {
            "client_secret": client_secret,
            "expires_after": expires_after,
            "url": ws_url,
            "prompt_id": prompt_id,
        },
        200,
        session_id if needs_cookie else None,
        needs_cookie,
    )


@app.post("/api/realtime/tool")
async def realtime_tool(request: Request) -> JSONResponse:
    session_id, session, needs_cookie = ensure_session(request)
    body = await read_json_body(request)
    name = read_string(body.get("name"))
    if not name:
        return respond({"error": "Tool name is required."}, 400, session_id if needs_cookie else None, needs_cookie)

    connection = session.google
    if name not in NON_GOOGLE_TOOLS and not connection:
        return respond({"error": "Google is not connected."}, 403, session_id if needs_cookie else None, needs_cookie)

    raw_arguments = (
        body.get("arguments")
        or body.get("args")
        or body.get("parameters")
        or body.get("params")
        or body.get("payload")
        or None
    )
    arguments = normalize_arguments(raw_arguments)
    alias = AliasService(session.alias_state)

    try:
        result = await run_in_threadpool(
            TOOL_EXECUTOR.execute,
            name,
            arguments,
            connection,
            alias,
            session,
        )
    except Exception as exc:  # noqa: BLE001
        return respond({"error": str(exc)}, 422, session_id if needs_cookie else None, needs_cookie)

    return respond({"result": result}, 200, session_id if needs_cookie else None, needs_cookie)


@app.get("/api/calendars")
async def calendars(request: Request) -> JSONResponse:
    session_id, session, needs_cookie = ensure_session(request)
    if not session.google:
        return respond({"error": "Google is not connected."}, 403, session_id if needs_cookie else None, needs_cookie)

    alias = AliasService(session.alias_state)
    try:
        available = await run_in_threadpool(
            VISIBILITY_SERVICE.available_calendars, session.google, session
        )
        visible = await run_in_threadpool(VISIBILITY_SERVICE.visible_calendars, session.google, session)
    except Exception as exc:  # noqa: BLE001
        return respond(
            {"error": f"Unable to load calendars right now: {exc}"},
            503,
            session_id if needs_cookie else None,
            needs_cookie,
        )

    visible_ids = {calendar["id"] for calendar in visible}
    calendars_payload = []
    for calendar in available:
        calendar_copy = dict(calendar)
        calendar_copy["selected"] = calendar["id"] in visible_ids
        calendars_payload.append(calendar_copy)

    return respond(
        {"calendars": alias.mask_calendars(calendars_payload)},
        200,
        session_id if needs_cookie else None,
        needs_cookie,
    )


@app.post("/api/calendars/visible")
async def update_calendars(request: Request) -> JSONResponse:
    session_id, session, needs_cookie = ensure_session(request)
    if not session.google:
        return respond({"error": "Google is not connected."}, 403, session_id if needs_cookie else None, needs_cookie)

    body = await read_json_body(request)
    raw_calendars = body.get("calendars") if isinstance(body.get("calendars"), list) else []
    alias = AliasService(session.alias_state)
    selected_ids = [alias.resolve_calendar(str(value)) for value in raw_calendars if isinstance(value, str)]

    try:
        visible = await run_in_threadpool(
            VISIBILITY_SERVICE.update_visible_calendars, session.google, session, selected_ids
        )
        available = await run_in_threadpool(
            VISIBILITY_SERVICE.available_calendars, session.google, session
        )
    except Exception as exc:  # noqa: BLE001
        return respond(
            {"error": f"Unable to save calendar visibility right now: {exc}"},
            503,
            session_id if needs_cookie else None,
            needs_cookie,
        )

    visible_ids = {calendar["id"] for calendar in visible}
    calendars_payload = []
    for calendar in available:
        calendar_copy = dict(calendar)
        calendar_copy["selected"] = calendar["id"] in visible_ids
        calendars_payload.append(calendar_copy)

    return respond(
        {"calendars": alias.mask_calendars(calendars_payload)},
        200,
        session_id if needs_cookie else None,
        needs_cookie,
    )


@app.get("/api/google/auth-url")
async def google_auth(request: Request) -> JSONResponse:
    logger.info("google_auth start", extra={"path": str(request.url)})
    session_id, session, needs_cookie = ensure_session(request)

    redirect_uri = _runtime_google_redirect_uri(request)
    try:
        url = build_google_auth_url(session, redirect_uri)
    except GoogleNotConfigured:
        return respond(
            {"error": "Google OAuth is not configured."},
            503,
            session_id if needs_cookie else None,
            needs_cookie,
        )

    logger.info("google_auth success", extra={"url": url})
    return respond({"url": url}, 200, session_id if needs_cookie else None, needs_cookie)


@app.get("/api/version")
async def version() -> Mapping[str, str]:
    return {"version": BUILD_HASH}


@app.get("/api/google/callback")
async def google_callback(request: Request, code: str | None = None, state: str | None = None):
    session_id, session, needs_cookie = ensure_session(request)
    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing OAuth parameters.")

    redirect_uri = _runtime_google_redirect_uri(request)
    try:
        await run_in_threadpool(handle_oauth_callback, session, code, state, redirect_uri)
    except GoogleNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    SESSION_STORE.reset_aliases(session_id)
    fallback_base = _determine_frontend_url(request)
    response = RedirectResponse(url=_settings_redirect_url(fallback_base))
    if needs_cookie:
        apply_cookie(response, session_id)
    return response


@app.post("/api/google/disconnect")
async def google_disconnect(request: Request) -> JSONResponse:
    session_id, session, needs_cookie = ensure_session(request)
    if session.google:
        disconnect_google(session)
        SESSION_STORE.reset_aliases(session_id)
    return respond({"disconnected": True}, 200, session_id if needs_cookie else None, needs_cookie)


def ensure_session(request: Request) -> Tuple[str, SessionData, bool]:
    existing = request.cookies.get(config.SESSION_COOKIE_NAME)
    session_id, session = SESSION_STORE.ensure(existing)
    return session_id, session, existing != session_id


def respond(
    payload: Mapping[str, Any],
    status_code: int,
    cookie_value: str | None = None,
    set_cookie: bool = False,
) -> JSONResponse:
    response = JSONResponse(payload, status_code=status_code)
    if set_cookie and cookie_value:
        apply_cookie(response, cookie_value)
    return response


def apply_cookie(response, cookie_value: str) -> None:
    response.set_cookie(
        key=config.SESSION_COOKIE_NAME,
        value=cookie_value,
        max_age=config.SESSION_COOKIE_MAX_AGE_SECONDS,
        httponly=True,
        samesite="lax",
        secure=config.is_prod(),
        path="/",
    )


def parse_json(response: httpx.Response) -> Mapping[str, Any]:
    try:
        parsed = response.json()
        return parsed if isinstance(parsed, Mapping) else {}
    except (json.JSONDecodeError, httpx.DecodingError):
        return {}


async def read_json_body(request: Request) -> Mapping[str, Any]:
    try:
        parsed = await request.json()
    except Exception:
        return {}
    return parsed if isinstance(parsed, Mapping) else {}


def resolve_prompt_id(body: Mapping[str, Any]) -> str | None:
    prompt = body.get("prompt", {})
    prompt_id = None
    if isinstance(prompt, Mapping):
        prompt_id = prompt.get("id")
    prompt_id = prompt_id or body.get("prompt_id") or body.get("promptId")
    env_prompt = config.realtime_prompt_id()
    if not prompt_id and env_prompt:
        prompt_id = env_prompt
    if prompt_id and isinstance(prompt_id, str) and prompt_id.strip():
        return prompt_id.strip()
    return None


def normalize_arguments(arguments: Any) -> dict:
    normalized = force_object(arguments)
    for wrapper in ("arguments", "payload", "data", "input", "tool", "body"):
        if isinstance(normalized, dict) and wrapper in normalized:
            normalized = force_object(normalized[wrapper])
    if isinstance(normalized, list):
        assoc: dict[str, Any] = {}
        for item in normalized:
            if not isinstance(item, (dict, list)):
                continue
            if isinstance(item, dict) and (
                "name" in item or "key" in item or "field" in item
            ):
                key = item.get("name") or item.get("key") or item.get("field")
                value = item.get("value") or item.get("val") or item.get("v")
                if key is not None and value is not None:
                    assoc[str(key)] = value
                continue
            if isinstance(item, dict):
                assoc.update(item)
        if assoc:
            normalized = assoc
    if not isinstance(normalized, dict):
        return {}
    return normalized


def force_object(value: Any) -> Any:
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
            if isinstance(decoded, (dict, list)):
                return decoded
        except json.JSONDecodeError:
            return {}
    if isinstance(value, dict):
        return value
    if isinstance(value, list):
        return value
    if value is None:
        return {}
    try:
        parsed = json.loads(json.dumps(value))
        return parsed if isinstance(parsed, (dict, list)) else {}
    except Exception:
        return {}


def read_string(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def serialize_user(user: UserProfile | None) -> Mapping[str, Any] | None:
    if not user:
        return None
    return {"id": user.id, "email": user.email, "name": user.name}


def serialize_google(session: SessionData) -> Mapping[str, Any]:
    connection = session.google
    return {
        "connected": bool(connection),
        "email": connection.email if connection else None,
        "expires_at": connection.expires_at.isoformat() if connection and connection.expires_at else None,
    }


def _determine_frontend_url(request: Request) -> str:
    base = str(request.base_url).rstrip("/")
    override_hosts = {"localhost", "127.0.0.1", "0.0.0.0"}
    parsed = urlparse(base)
    if parsed.hostname in override_hosts:
        return "http://localhost:3000"
    return base


def _runtime_google_redirect_uri(request: Request) -> str:
    base = str(request.base_url).rstrip("/")
    return f"{base}/api/google/callback"


def _settings_redirect_url(fallback_base: str) -> str:
    base = config.frontend_url(fallback_base).rstrip("/")
    settings_path = config.frontend_settings_path()

    # Preserve hash fragments; avoid stripping leading '#'
    if settings_path.startswith("#"):
        redirect = f"{base}/{settings_path}"
    else:
        redirect = f"{base}/{settings_path.lstrip('/')}"

    return redirect


_repo_root = Path(__file__).resolve().parents[2]
_default_frontend_dist = _repo_root / "frontend" / "dist"
_frontend_dist_dir = Path(os.environ.get("FRONTEND_DIST_DIR") or _default_frontend_dist)
if _frontend_dist_dir.is_dir():
    app.mount("/", StaticFiles(directory=str(_frontend_dist_dir), html=True), name="frontend")
else:
    @app.get("/")
    async def root() -> Mapping[str, str]:
        return {"message": "Realtime Assistant API", "docs": "/docs"}
