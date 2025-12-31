# Managed ChatKit starter

Vite + React UI that talks to a FastAPI session backend for creating ChatKit
workflow sessions.

## Quick start

```bash
npm install           # installs root deps (concurrently)
npm run dev           # runs FastAPI on :8000 and Vite on :3000
```

What happens:

- `npm run dev` runs the backend via `backend/scripts/run.sh` (FastAPI +
  uvicorn) and the frontend via `npm --prefix frontend run dev`.
- The backend exposes `/api/create-session`, exchanging your workflow id and
  `OPENAI_API_KEY` for a ChatKit client secret. The Vite dev server proxies
  `/api/*` to `127.0.0.1:8000`.

## Required environment

- `OPENAI_API_KEY`
- `VITE_CHATKIT_WORKFLOW_ID`
- (optional) `CHATKIT_API_BASE` or `VITE_CHATKIT_API_BASE` (defaults to `https://api.openai.com`)
- (optional) `VITE_API_URL` (override the dev proxy target for `/api`)
- (optional) `CHATKIT_WORKFLOW_VERSION` to pin a workflow version
- (optional) `APP_TIMEZONE` to control state-variable time parsing (defaults to UTC)

### Google + calendar sharing

The FastAPI backend mirrors the legacy app’s tool server and calendar controls:

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (default `http://127.0.0.1:8000/api/google/callback`)
- Calendar scopes default to Tasks + Calendar; override with `GOOGLE_SCOPES` if needed.
- Users sign in on the **Settings** page, connect Google, then pick which calendars to expose via `/api/calendars` and `/api/calendars/visible`. Primary is always included. Read-only calendars are merged into `list_events` responses but tool updates are blocked.

Tool calls mask Google IDs with numeric aliases (tasks, task lists, calendars, events) so the workflow never sees raw Google identifiers. Shared calendars are tagged `readonly` and enforced in `update_event`. Event defaults (start time + duration) follow `GOOGLE_EVENT_START_TIME` and `GOOGLE_EVENT_DURATION_MINUTES`.

Set the env vars in your shell (or process manager) before running. Use a
workflow id from Agent Builder (starts with `wf_...`) and an API key from the
same project and organization.

## Customize

- Chat UI: `frontend/src/pages/ChatPage.tsx` and `frontend/src/components/ChatKitPanel.tsx`
- Settings + calendar visibility: `frontend/src/pages/SettingsPage.tsx`
- Session + tool server logic: `backend/app/main.py`, `backend/app/tools.py`
- Google + calendar safety: `backend/app/google.py`, `backend/app/calendar_visibility.py`, `backend/app/alias.py`
