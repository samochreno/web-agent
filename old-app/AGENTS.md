## Overview
- This Laravel app embeds an OpenAI Agent Builder workflow (via ChatKit) to power a car-friendly assistant with two modes: **general chat** and **scheduling** (Google Tasks + Calendar).
- ChatKit is optional and gated by `CHATKIT_ENABLED`. When enabled, the frontend (`resources/js/Pages/Chat.vue`) mounts the `<openai-chatkit>` web component and requests a client secret from `ChatKitSessionController`, which forwards workflow metadata plus session state (date, time, day).
- ChatKit tool calls are received by `ChatKitToolController` and dispatched to `AgentLoopService::executeTool`, which bridges to Google Tasks/Calendar through alias masking so IDs are never leaked to the model.
- The legacy chat box routes (`ChatController`) still use `AgentLoopService::handle` for direct OpenAI chat + tool calling, sharing the same session history and alias registry.

## Key components
- **Agent orchestration**: `app/Services/Agent/AgentLoopService.php` (OpenAI chat, tool schema, tool execution), `ChatSessionManager` (session-scoped message history), `AliasService` (numeric aliases for Google IDs).
- **Google integration**: `GoogleOAuthService` (connect/disconnect/lookup), `GoogleTasksService` and `GoogleCalendarService`, plus `SchedulingResolver` for default time windows.
- **ChatKit plumbing**: `ChatKitSessionService` (creates ChatKit sessions) and `ChatKitToolController` (normalizes tool payloads from the widget).
- **Frontend shell**: `resources/js/Pages/Chat.vue` mounts ChatKit, surfaces workflow/version info, and provides Google connection entrypoints.
- See `docs/AGENT_WORKFLOW.md` for a deeper walkthrough of the Agent Builder routing (general chat vs. scheduling) and the tool contract.

## Behavior & constraints
- Always honor the alias layer when touching Google resources; never expose raw Google IDs to the model or UI. Register or resolve through `AliasService` before using IDs.
- Scheduling defaults live in `config/google.php` (`event_defaults.start_time`, `event_defaults.duration_minutes`). Use those instead of hard-coding.
- Timezone-sensitive parsing should come from `config('app.timezone')`. Google Tasks due dates are date-only; strip times on input (`AgentLoopService::parseDateOnly`).
- ChatKit and tool endpoints must stay behind `chatkit.enabled` checks. Do not return workflow secrets; only the client secret is returned to the frontend.
- OpenAI guardrail: if `OPENAI_API_KEY` is missing, `AgentLoopService::handle` responds with a fallback message—preserve this behavior.
- Voice/car assistant context: keep responses concise, avoid verbose multi-step outputs, and prefer explicit confirmations with resolved times to minimize driver distraction.

## Adding or changing tools
- Keep the JSON schema in `AgentLoopService::toolSchema()` in sync with execution branches in `executeTool()`. New tools must register aliases consistently.
- Normalize incoming arguments instead of expanding validation rules; ChatKit payloads can be nested or stringified JSON.
- When introducing new Google calls, update alias masking + reverse lookup and ensure update/patch calls only mutate provided fields (never overwrite unspecified values).

## Testing & local checks
- PHP: `./vendor/bin/phpunit`
- Frontend/Vite lint (if configured): `npm run lint`
- Laravel app shell: `php artisan serve` (development only)

## Documentation expectations
- If you add new agent behaviors, update or add a focused markdown note under `docs/` and cross-link it here so future agents can find it.
