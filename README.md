# GPT Realtime voice assistant starter

Vite + React UI that talks to a FastAPI backend for creating GPT Realtime
sessions, streaming voice + text, and running Google-backed tools.

## Quick start

```bash
npm install           # installs root deps (concurrently)
npm run dev           # runs FastAPI on :8000 and Vite on :3000
```

What happens:

- `npm run dev` runs the backend via `backend/scripts/run.sh` (FastAPI +
  uvicorn) and the frontend via `npm --prefix frontend run dev`.
- The backend exposes `/api/realtime/session`, exchanging your published prompt
  id and `OPENAI_API_KEY` for a Realtime client secret and websocket URL. The
  Vite dev server proxies `/api/*` to `127.0.0.1:8000`.

## Required environment

- `OPENAI_API_KEY`
- `VITE_REALTIME_PROMPT_ID` (or `REALTIME_PROMPT_ID`)
- (optional) `REALTIME_API_BASE` or `VITE_REALTIME_API_BASE` (defaults to `https://api.openai.com`)
- (optional) `VITE_API_URL` (override the dev proxy target for `/api`)
- (optional) `APP_TIMEZONE` to control task/event parsing (defaults to UTC)

### Google + calendar sharing

The FastAPI backend mirrors the legacy app’s tool server and calendar controls:

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (default `http://127.0.0.1:8000/api/google/callback`)
- Calendar scopes default to Tasks + Calendar; override with `GOOGLE_SCOPES` if needed.
- Users sign in on the **Settings** page, connect Google, then pick which calendars to expose via `/api/calendars` and `/api/calendars/visible`. Primary is always included. Read-only calendars are merged into `list_events` responses but tool updates are blocked.

Tool calls mask Google IDs with numeric aliases (tasks, task lists, calendars, events) so the model never sees raw Google identifiers. Shared calendars are tagged `readonly` and enforced in `update_event`. Event defaults (start time + duration) follow `GOOGLE_EVENT_START_TIME` and `GOOGLE_EVENT_DURATION_MINUTES`.

Set the env vars in your shell (or process manager) before running. Use a
published prompt id (starts with `pmpt_...`) and an API key from the same
project and organization.

## Customize

- Realtime UI: `frontend/src/pages/ChatPage.tsx` and `frontend/src/components/RealtimePanel.tsx`
- Settings + calendar visibility: `frontend/src/pages/SettingsPage.tsx`
- Session + tool server logic: `backend/app/main.py`, `backend/app/tools.py`
- Google + calendar safety: `backend/app/google.py`, `backend/app/calendar_visibility.py`, `backend/app/alias.py`
