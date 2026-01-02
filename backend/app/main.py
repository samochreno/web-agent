"""FastAPI entrypoint for ChatKit sessions, tool calls, and Google connectivity."""

from __future__ import annotations

import json
import os
import uuid
from typing import Any, Mapping, Tuple

import httpx
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool

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
from .state import ChatKitStateService
from .tools import ToolExecutor

app = FastAPI(title="Managed ChatKit Session API")

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
STATE_SERVICE = ChatKitStateService(TASKS_SERVICE)
TOOL_EXECUTOR = ToolExecutor(TASKS_SERVICE, CALENDAR_SERVICE, VISIBILITY_SERVICE)


@app.get("/health")
async def health() -> Mapping[str, str]:
    return {"status": "ok"}


@app.get("/api/auth/session")
async def auth_session(request: Request) -> JSONResponse:
    session_id, session, needs_cookie = ensure_session(request)
    payload = {
        "user": serialize_user(session.user),
        "google": serialize_google(session),
        "workflow": {"id": config.workflow_id(), "version": config.workflow_version()},
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


@app.post("/api/create-session")
async def create_session(request: Request) -> JSONResponse:
    """Exchange a workflow id for a ChatKit client secret."""
    api_key = read_string(os.getenv("OPENAI_API_KEY"))
    if not api_key:
        return respond({"error": "Missing OPENAI_API_KEY environment variable"}, 500)

    session_id, session, needs_cookie = ensure_session(request)
    body = await read_json_body(request)
    workflow_id = resolve_workflow_id(body)
    if not workflow_id:
        return respond({"error": "Missing workflow id"}, 400, session_id if needs_cookie else None, needs_cookie)

    user_identifier = session.user.id if session.user else session_id
    api_base = config.chatkit_api_base()
    workflow_payload = {
        "id": workflow_id,
        "version": config.workflow_version(),
        "state_variables": STATE_SERVICE.variables(session.google, session),
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "OpenAI-Beta": "chatkit_beta=v1",
        "Content-Type": "application/json",
    }
    organization = config.organization()
    if organization:
        headers["OpenAI-Organization"] = organization

    try:
        async with httpx.AsyncClient(base_url=api_base, timeout=10.0) as client:
            upstream = await client.post(
                "/v1/chatkit/sessions",
                headers=headers,
                json={"workflow": workflow_payload, "user": user_identifier},
            )
    except httpx.RequestError as error:
        return respond(
            {"error": f"Failed to reach ChatKit API: {error}"},
            502,
            session_id if needs_cookie else None,
            needs_cookie,
        )

    payload = parse_json(upstream)
    if not upstream.is_success:
        message = payload.get("error") if isinstance(payload, Mapping) else None
        message = message or upstream.reason_phrase or "Failed to create session"
        return respond({"error": message}, upstream.status_code, session_id if needs_cookie else None, needs_cookie)

    client_secret = payload.get("client_secret") if isinstance(payload, Mapping) else None
    expires_after = payload.get("expires_after") if isinstance(payload, Mapping) else None
    if not client_secret:
        return respond(
            {"error": "Missing client secret in response"},
            502,
            session_id if needs_cookie else None,
            needs_cookie,
        )

    SESSION_STORE.reset_aliases(session_id)
    return respond(
        {"client_secret": client_secret, "expires_after": expires_after},
        200,
        session_id if needs_cookie else None,
        needs_cookie,
    )


@app.post("/api/chatkit/tool")
@app.post("/chatkit/tool")
async def chatkit_tool(request: Request) -> JSONResponse:
    session_id, session, needs_cookie = ensure_session(request)
    body = await read_json_body(request)
    name = read_string(body.get("name"))
    if not name:
        return respond({"error": "Tool name is required."}, 400, session_id if needs_cookie else None, needs_cookie)

    connection = session.google
    if not connection:
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


@app.post("/api/transcriptions")
async def transcriptions(file: UploadFile = File(...)) -> JSONResponse:
    api_key = read_string(os.getenv("OPENAI_API_KEY"))
    if not api_key:
        return respond({"error": "Missing OPENAI_API_KEY environment variable"}, 500)

    audio_bytes = await file.read()
    if not audio_bytes:
        return respond({"error": "Audio file is empty"}, 400)

    headers = {"Authorization": f"Bearer {api_key}"}
    organization = config.organization()
    if organization:
        headers["OpenAI-Organization"] = organization

    files = {
        "file": (
            file.filename or "speech.wav",
            audio_bytes,
            file.content_type or "audio/wav",
        )
    }

    data = {
        "model": "gpt-4o-transcribe",
        "language": "sk",
    }

    api_base = config.chatkit_api_base().rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            upstream = await client.post(
                f"{api_base}/v1/audio/transcriptions",
                headers=headers,
                files=files,
                data=data,
            )
    except httpx.RequestError as error:
        return respond({"error": f"Transcription request failed: {error}"}, 502)

    payload = parse_json(upstream)
    if not upstream.is_success:
        message = payload.get("error") if isinstance(payload, Mapping) else None
        message = message or upstream.reason_phrase or "Failed to transcribe audio"
        return respond({"error": message}, upstream.status_code)

    text = payload.get("text") if isinstance(payload, Mapping) else None
    if not text:
        return respond({"error": "Missing transcription text in response"}, 502)

    return respond({"text": text}, 200)


@app.post("/api/speech")
async def speech(request: Request) -> JSONResponse | StreamingResponse:
    api_key = read_string(os.getenv("OPENAI_API_KEY"))
    if not api_key:
        return respond({"error": "Missing OPENAI_API_KEY environment variable"}, 500)

    body = await read_json_body(request)
    text = read_string(body.get("text")) or read_string(body.get("message"))
    if not text:
        return respond({"error": "Text is required"}, 400)

    voice = read_string(body.get("voice")) or "alloy"
    response_format = read_string(body.get("format")) or "mp3"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    organization = config.organization()
    if organization:
        headers["OpenAI-Organization"] = organization

    payload = {
        "model": "gpt-4o-mini-tts",
        "input": text,
        "voice": voice,
        "response_format": response_format,
        "stream": True,
    }

    api_base = config.chatkit_api_base().rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=None, base_url=api_base) as client:
            try:
                upstream = await client.stream(
                    "POST", "/v1/audio/speech", headers=headers, json=payload
                )
            except httpx.RequestError as error:
                return respond({"error": f"Speech request failed: {error}"}, 502)

            if not upstream.is_success:
                detail = await upstream.aread()
                message = None
                try:
                    parsed_error = json.loads(detail.decode("utf-8")) if detail else None
                    if isinstance(parsed_error, Mapping):
                        message = parsed_error.get("error") or parsed_error.get("message")
                except Exception:
                    message = None
                await upstream.aclose()
                return respond(
                    {"error": message or upstream.reason_phrase or "Failed to synthesize speech"},
                    upstream.status_code,
                )

            content_type = upstream.headers.get("content-type") or "audio/mpeg"

            async def audio_stream():
                try:
                    async for chunk in upstream.aiter_bytes():
                        if chunk:
                            yield chunk
                finally:
                    await upstream.aclose()

            return StreamingResponse(audio_stream(), media_type=content_type)
    except httpx.RequestError as error:
        return respond({"error": f"Speech request failed: {error}"}, 502)


@app.get("/api/calendars")
async def calendars(request: Request) -> JSONResponse:
    session_id, session, needs_cookie = ensure_session(request)
    if not session.user:
        return respond({"error": "Login required."}, 401, session_id if needs_cookie else None, needs_cookie)
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
    if not session.user:
        return respond({"error": "Login required."}, 401, session_id if needs_cookie else None, needs_cookie)
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
    session_id, session, needs_cookie = ensure_session(request)
    if not session.user:
        return respond({"error": "Login required."}, 401, session_id if needs_cookie else None, needs_cookie)

    try:
        url = build_google_auth_url(session)
    except GoogleNotConfigured:
        return respond(
            {"error": "Google OAuth is not configured."},
            503,
            session_id if needs_cookie else None,
            needs_cookie,
        )

    return respond({"url": url}, 200, session_id if needs_cookie else None, needs_cookie)


@app.get("/api/google/callback")
async def google_callback(request: Request, code: str | None = None, state: str | None = None):
    session_id, session, needs_cookie = ensure_session(request)
    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing OAuth parameters.")

    try:
        await run_in_threadpool(handle_oauth_callback, session, code, state)
    except GoogleNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    SESSION_STORE.reset_aliases(session_id)
    response = RedirectResponse(url=f"{config.frontend_base_url().rstrip('/')}/settings?google=connected")
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


def resolve_workflow_id(body: Mapping[str, Any]) -> str | None:
    workflow = body.get("workflow", {})
    workflow_id = None
    if isinstance(workflow, Mapping):
        workflow_id = workflow.get("id")
    workflow_id = workflow_id or body.get("workflowId")
    env_workflow = config.workflow_id()
    if not workflow_id and env_workflow:
        workflow_id = env_workflow
    if workflow_id and isinstance(workflow_id, str) and workflow_id.strip():
        return workflow_id.strip()
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
