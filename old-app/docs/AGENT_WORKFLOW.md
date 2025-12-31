# Agent Builder workflow guide

Use this guide to orient any AI agents that need to extend the car assistant or its ChatKit + Agent Builder workflow.

## High-level flow
1. **Start (Voice/Text input)** → Agent Builder **Classify** node decides between:
   - `GENERAL_CHAT`: lightweight assistant responses (no scheduling tool use needed).
   - `SCHEDULE`: task/calendar oriented path that calls backend tools.
2. **ChatKit runtime** renders in `resources/js/Pages/Chat.vue`, fetches a client secret from `ChatKitSessionController`, and routes tool calls to `/chatkit/tool`. The primary chat UI now streams Agent Builder responses directly through the ChatKit client secret (no legacy system prompt).
3. **Tool handling** lands in `ChatKitToolController`, which normalizes payloads and dispatches to `AgentLoopService::executeTool`.
4. **Google integrations** run through `GoogleTasksService` + `GoogleCalendarService`, with alias masking from `AliasService` to keep IDs opaque to the model and UI.
5. **Session state** is stored in `ChatSessionManager`, so the model sees prior tool calls and assistant/user turns.

## Data passed to ChatKit sessions
- `workflow.id` and optional `workflow.version` from `config/chatkit.php`.
- `state_variables`: `date`, `time`, `day` (all derived from `config('app.timezone')` in `ChatKitSessionController`).
- Only the `client_secret` is returned to the browser; workflow IDs and API keys stay server-side.

## Tool menu (AgentLoopService)
- `list_task_lists`: Returns aliased task lists.
- `list_tasks`: Date-windowed tasks; returns aliased IDs. Overdue tasks are included if the start date is in the past.
- `create_task`: Date-only due dates. Aliases the created task + list.
- `update_task`: Only updates provided fields; ignores empty strings. Due date is stripped to date-only. Explicit `null` clears due dates.
- `list_events`: Calendar events for a local time range; aliases IDs.
- `create_event`: Requires title; auto-fills start/end if missing using `SchedulingResolver` (default start time + duration from `config/google.php`).
- `update_event`: Only provided fields are patched. `null` clears fields. Resolves aliases before calling Google.

All tools require a connected Google account; otherwise a 403 is returned before tool execution.

## Shared calendars (read-only)
- Users can opt into read-only shared calendars via the Chat UI; selected calendars are merged into `list_events` responses without exposing raw calendar IDs. See [docs/SHARED_CALENDARS.md](./SHARED_CALENDARS.md) for the data flow and enforcement details.

## Scheduling defaults
- Defaults live in `config/google.php` under `event_defaults`:
  - `start_time` (HH:MM, local timezone)
  - `duration_minutes` (integer)
- Google Tasks due dates are date-only; any time component supplied by the model or user should be ignored or stripped (`AgentLoopService::parseDateOnly`).

## Voice/car assistant considerations
- Keep confirmations compact and include resolved times/dates so the driver does not need to infer defaults.
- Avoid long multi-turn suggestions; prefer a single actionable reply.
- If OpenAI credentials are missing, the backend returns a safe fallback (“OpenAI is not configured yet…”); do not bypass this.

## Where to change behaviors
- Tool schema & execution: `app/Services/Agent/AgentLoopService.php`
- ChatKit session creation: `app/Services/Chat/ChatKitSessionService.php`
- Tool ingress + normalization: `app/Http/Controllers/ChatKitToolController.php`
- Google defaults: `config/google.php`
- Session history: `app/Services/Chat/ChatSessionManager.php`

When updating these areas, keep alias handling intact and stay in sync between schema and execution branches.
