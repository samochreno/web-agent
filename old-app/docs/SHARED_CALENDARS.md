# Shared calendar visibility (read-only)

The agent now injects events from selected shared calendars into `list_events` responses without exposing the calendars themselves to the model.

- **Selection UI**: Users pick calendars in the Chat page via `/calendars` (GET) and `/calendars/visible` (POST). Calendar IDs are masked through `AliasService`, and primary is always included.
- **Visibility storage**: `CalendarVisibilityService` caches available calendars (`calendarList.list`) and stores the user’s visible set per Google connection. Only calendars with `accessRole` `owner`/`writer`/`reader` are surfaced; defaults fall back to primary.
- **Read-only enforcement**: Events from non-writable calendars are tagged `readonly` and registered with an alias carrying that flag. `AgentLoopService::listEvents` merges them into the tool output, and `update_event` rejects edits against read-only calendars.

No new tools were added; the model continues to call `list_events` as before and simply receives merged results that include read-only shared calendars.
