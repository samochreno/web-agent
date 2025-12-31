<?php

namespace App\Services\Agent;

use App\Models\GoogleConnection;
use App\Services\Chat\ChatSessionManager;
use App\Services\Google\GoogleCalendarService;
use App\Services\Google\GoogleTasksService;
use App\Services\Google\CalendarVisibilityService;
use App\Services\Scheduling\SchedulingResolver;
use Illuminate\Support\Arr;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Log;
use OpenAI\Client;
use App\Services\Agent\AliasService;

class AgentLoopService
{
    public function __construct(
        private readonly Client $client,
        private readonly ChatSessionManager $sessionManager,
        private readonly GoogleTasksService $tasksService,
        private readonly GoogleCalendarService $calendarService,
        private readonly CalendarVisibilityService $calendarVisibilityService,
        private readonly SchedulingResolver $schedulingResolver,
        private readonly AliasService $aliasService,
    ) {
    }

    public function handle(string $message, ?GoogleConnection $connection): string
    {
        if (empty($this->sessionManager->history())) {
            $this->bootstrap($connection);
        }

        $this->sessionManager->append('user', $message);

        if (!Config::get('services.openai.api_key')) {
            $fallback = 'OpenAI is not configured yet. Please add OPENAI_API_KEY to continue.';
            $this->sessionManager->append('assistant', $fallback);

            return $fallback;
        }

        $response = $this->client->chat()->create([
            'model' => 'gpt-4.1',
            'messages' => $this->sessionManager->history(),
            'tools' => $this->toolSchema(),
        ]);

        $reply = $response->choices[0]->message;

        if (!empty($reply->toolCalls)) {
            $assistantMessage = [
                'role' => 'assistant',
                'content' => $reply->content ?? '',
                'tool_calls' => collect($reply->toolCalls)->map(fn ($call) => [
                    'id' => $call->id,
                    'type' => 'function',
                    'function' => [
                        'name' => $call->function->name,
                        'arguments' => $call->function->arguments,
                    ],
                ])->toArray(),
            ];
            $this->sessionManager->appendMessage($assistantMessage);

            $toolOutputs = $this->handleToolCalls($reply->toolCalls, $connection);

            foreach ($toolOutputs as $toolCallId => $toolResult) {
                $this->sessionManager->appendMessage([
                    'role' => 'tool',
                    'tool_call_id' => $toolCallId,
                    'content' => json_encode($toolResult, JSON_PRETTY_PRINT),
                ]);
            }

            $response = $this->client->chat()->create([
                'model' => 'gpt-4.1',
                'messages' => $this->sessionManager->history(),
            ]);

            $final = $response->choices[0]->message->content;
            $this->sessionManager->append('assistant', $final);

            return $final;
        }

        $final = $reply->content ?? '';
        $this->sessionManager->append('assistant', $final);

        return $final;
    }

    private function bootstrap(?GoogleConnection $connection): void
    {
        $this->aliasService->reset();
    }

    private function handleToolCalls(array $toolCalls, ?GoogleConnection $connection): array
    {
        $outputs = [];

        foreach ($toolCalls as $toolCall) {
            $name = $toolCall->function->name ?? $toolCall->name;
            $arguments = json_decode($toolCall->function->arguments ?? '{}', true) ?? [];

            try {
                $outputs[$toolCall->id] = $this->executeTool($name, $arguments, $connection);
            } catch (\Throwable $e) {
                $outputs[$toolCall->id] = [
                    'error' => $e->getMessage(),
                ];
            }
        }

        return $outputs;
    }

    public function executeTool(string $name, array $arguments, ?GoogleConnection $connection): array
    {
        if (!$connection) {
            throw new \RuntimeException('Google is not connected.');
        }

        return match ($name) {
            'list_task_lists' => [
                'data' => $this->aliasService->maskTaskLists(
                    $this->tasksService->listTaskLists($connection)
                ),
            ],
            'list_tasks' => [
                'task_list_id' => $this->aliasService->registerTaskList(
                    $this->resolveTaskListId($connection, $arguments['task_list_id'] ?? null)
                ),
                'data' => (function () use ($connection, $arguments) {
                    $taskListId = $this->resolveTaskListId($connection, $arguments['task_list_id'] ?? null);
                    $start = isset($arguments['start_date']) && $arguments['start_date'] !== null
                        ? Carbon::parse($arguments['start_date'], Config::get('app.timezone'))
                        : null;
                    $end = isset($arguments['end_date']) && $arguments['end_date'] !== null
                        ? Carbon::parse($arguments['end_date'], Config::get('app.timezone'))
                        : null;

                    $tasks = $this->tasksService->listTasks($connection, $taskListId, $start, $end);

                    return $this->aliasService->maskTasks($tasks, $taskListId);
                })(),
            ],
            'create_task' => $this->createTask($connection, $arguments),
            'update_task' => $this->updateTask($connection, $arguments),
            'list_events' => $this->listEvents($connection, $arguments),
            'create_event' => $this->createEvent($connection, $arguments),
            'update_event' => $this->updateEvent($connection, $arguments),
            default => ['error' => 'Unknown tool ' . $name],
        };
    }

    private function createTask(GoogleConnection $connection, array $arguments): array
    {
        $taskListId = $this->resolveTaskListId($connection, $arguments['task_list_id'] ?? null);
        $due = $this->resolveDueDate(Arr::get($arguments, 'due_date'));

        $task = $this->tasksService->createTask(
            $connection,
            $taskListId,
            $arguments['title'],
            $arguments['notes'] ?? null,
            $due
        );

        return [
            'task_list_id' => $this->aliasService->registerTaskList($taskListId),
            'created' => $this->aliasService->maskTask($task, $taskListId),
        ];
    }

    private function updateTask(GoogleConnection $connection, array $arguments): array
    {
        $taskListIdAlias = $this->argument($arguments, 'task_list_id');
        $taskListId = $this->resolveTaskListId($connection, $taskListIdAlias);
        $taskIdAlias = $this->argument($arguments, 'task_id');

        if (!$taskIdAlias) {
            throw new \InvalidArgumentException('task_id is required');
        }
        [$taskListId, $taskId] = $this->aliasService->resolveTask($taskListId, $taskIdAlias);
        $payload = [];

        foreach (['title', 'notes'] as $field) {
            if (array_key_exists($field, $arguments)) {
                $value = $arguments[$field];

                if ($value !== null && $value !== '') {
                    $payload[$field] = $value;
                }
            }
        }

        $hasDueDate = array_key_exists('due_date', $arguments);

        if ($hasDueDate) {
            $due = $this->resolveUpdatedDueDate($arguments);

            if ($due) {
                $payload['due'] = $due;
            }
        }

        $task = $this->tasksService->updateTask(
            $connection,
            $taskListId,
            $taskId,
            $payload
        );

        return [
            'task_list_id' => $this->aliasService->registerTaskList($taskListId),
            'task_id' => $this->aliasService->registerTask($taskListId, $task['id']),
            'updated' => $this->aliasService->maskTask($task, $taskListId),
        ];
    }

    /**
     * Safe accessor that supports multiple key shapes (snake, camel, nested) and skips null/empty values.
     */
    private function argument(array $arguments, string ...$keys): mixed
    {
        $found = false;

        foreach ($keys as $key) {
            if (!Arr::has($arguments, $key)) {
                continue;
            }

            $found = true;
            $value = Arr::get($arguments, $key);

            if ($value !== null && $value !== '') {
                return $value;
            }
        }

        return $found ? null : null;
    }

    /**
     * Resolve a new due date as a date-only value; time components are ignored by Google Tasks.
     */
    private function resolveUpdatedDueDate(array $arguments): ?Carbon
    {
        if (!array_key_exists('due_date', $arguments)) {
            return null;
        }

        $provided = $arguments['due_date'];

        if ($provided === null || $provided === '') {
            return null;
        }

        return $this->parseDateOnly($provided);
    }

    /**
     * Normalize a date input down to a Carbon instance at start of day. Returns null on parse failure.
     */
    private function parseDateOnly(?string $value): ?Carbon
    {
        if (!$value) {
            return null;
        }

        try {
            // Normalize Google Tasks due dates in UTC to avoid timezone boundary shifts.
            return Carbon::parse($value, 'UTC')->startOfDay();
        } catch (\Throwable) {
            return null;
        }
    }

    private function listEvents(GoogleConnection $connection, array $arguments): array
    {
        $from = Carbon::parse($arguments['start_date'], Config::get('app.timezone'));
        $to = Carbon::parse($arguments['end_date'], Config::get('app.timezone'))->endOfDay();

        try {
            $calendars = $this->calendarVisibilityService->visibleCalendars($connection);
        } catch (\Throwable $e) {
            Log::warning('Unable to load visible calendars', ['error' => $e->getMessage()]);
            $calendars = collect();
        }

        if ($calendars->isEmpty()) {
            $calendars = collect([[
                'id' => 'primary',
                'name' => 'Primary calendar',
                'primary' => true,
                'access_role' => 'owner',
                'readonly' => false,
            ]]);
        }

        $events = collect();

        foreach ($calendars as $calendar) {
            $calendarId = $calendar['id'] ?? 'primary';
            $readonly = (bool) ($calendar['readonly'] ?? $this->calendarVisibilityService->isReadonlyAccess($calendar['access_role'] ?? null));

            try {
                $calendarEvents = $this->calendarService->listEvents($connection, $calendarId, $from, $to)
                    ->map(function (array $event) use ($calendar, $calendarId, $readonly) {
                        return array_merge($event, [
                            'calendar_id' => $calendarId,
                            'calendar' => $calendar['name'] ?? 'Calendar',
                            'readonly' => $readonly,
                        ]);
                    });

                $events = $events->concat($calendarEvents);
            } catch (\Throwable $e) {
                Log::warning('Unable to list events for calendar', [
                    'calendar_id' => $calendarId,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        $ordered = $events
            ->sortBy(function (array $event) {
                $start = $event['start'] ?? null;

                try {
                    return $start ? Carbon::parse($start, Config::get('app.timezone'))->timestamp : 0;
                } catch (\Throwable) {
                    return 0;
                }
            })
            ->values();

        return [
            'events' => $this->aliasService->maskEvents($ordered),
        ];
    }

    private function createEvent(GoogleConnection $connection, array $arguments): array
    {
        $summary = $this->argument($arguments, 'summary', 'title', 'name');

        if (!$summary) {
            throw new \InvalidArgumentException('Event summary/title is required.');
        }

        $startDateTime = $this->argument($arguments, 'start_datetime', 'startDateTime', 'start');
        $endDateTime = $this->argument($arguments, 'end_datetime', 'endDateTime', 'end');
        $description = $arguments['notes'] ?? $arguments['description'] ?? null;
        $location = $arguments['location'] ?? null;

        if ($startDateTime || $endDateTime) {
            $start = $this->parseDateTimeOrFail($startDateTime, 'start_datetime');
            $end = $endDateTime
                ? $this->parseDateTimeOrFail($endDateTime, 'end_datetime')
                : $start->copy()->addMinutes(Config::get('google.event_defaults.duration_minutes', 60));
        } else {
            [$start, $end] = $this->schedulingResolver->resolveEventWindow(
                Arr::get($arguments, 'date'),
                Arr::get($arguments, 'start_time'),
                Arr::get($arguments, 'end_time'),
            );
        }

        $event = $this->calendarService->createEvent(
            $connection,
            'primary',
            $summary,
            $description,
            $start,
            $end,
            $location
        );

        return ['event' => $this->aliasService->maskEvent($event, 'primary')];
    }

    private function parseDateTimeOrFail(?string $value, string $field): Carbon
    {
        if (!$value) {
            throw new \InvalidArgumentException("{$field} is required when using explicit datetimes.");
        }

        try {
            return Carbon::parse($value, Config::get('app.timezone'));
        } catch (\Throwable) {
            throw new \InvalidArgumentException("Invalid {$field} value.");
        }
    }

    private function updateEvent(GoogleConnection $connection, array $arguments): array
    {
        $eventId = $arguments['event_id'] ?? null;

        if (!$eventId) {
            throw new \InvalidArgumentException('event_id is required');
        }

        [$calendarId, $resolvedEventId] = $this->aliasService->resolveEvent($eventId);

        if ($this->aliasService->eventIsReadonly($eventId) || $this->calendarVisibilityService->isReadonly($connection, $calendarId)) {
            throw new \RuntimeException('Events from shared calendars are view-only.');
        }

        $payload = [];

        if (array_key_exists('title', $arguments) && $arguments['title'] !== null && $arguments['title'] !== '') {
            $payload['summary'] = $arguments['title'];
        }

        if (array_key_exists('notes', $arguments) && $arguments['notes'] !== null && $arguments['notes'] !== '') {
            $payload['description'] = $arguments['notes'];
        }

        if (array_key_exists('location', $arguments) && $arguments['location'] !== null && $arguments['location'] !== '') {
            $payload['location'] = $arguments['location'];
        }

        if (array_key_exists('start_datetime', $arguments) && $arguments['start_datetime'] !== null && $arguments['start_datetime'] !== '') {
            $payload['start'] = $this->parseDateTimeOrFail($arguments['start_datetime'], 'start_datetime');
        }

        if (array_key_exists('end_datetime', $arguments) && $arguments['end_datetime'] !== null && $arguments['end_datetime'] !== '') {
            $payload['end'] = $this->parseDateTimeOrFail($arguments['end_datetime'], 'end_datetime');
        }

        $event = $this->calendarService->updateEvent(
            $connection,
            $calendarId,
            $resolvedEventId,
            $payload
        );

        return ['event' => $this->aliasService->maskEvent($event, $calendarId)];
    }

    private function resolveDueDate(?string $date): ?Carbon
    {
        if ($date === null || $date === '') {
            return null;
        }

        return $this->parseDateOnly($date);
    }

    private function resolveTaskListId(GoogleConnection $connection, ?string $taskListId): string
    {
        if ($taskListId) {
            return $this->aliasService->resolveTaskList($taskListId);
        }

        $lists = $this->tasksService->listTaskLists($connection);

        if ($lists->isEmpty()) {
            throw new \RuntimeException('No task lists are available for this account.');
        }

        $id = $lists->first()['id'];
        // Ensure default list is aliased for downstream calls.
        $this->aliasService->registerTaskList($id);

        return $id;
    }

    private function toolSchema(): array
    {
        return [
            [
                'type' => 'function',
                'function' => [
                    'name' => 'list_task_lists',
                    'description' => 'List all Google Tasks task lists for the user.',
                    'strict' => true,
                    'parameters' => [
                        'type' => 'object',
                        'properties' => new \stdClass(),
                        'additionalProperties' => false,
                        'required' => [],
                    ],
                ],
            ],
            [
                'type' => 'function',
                'function' => [
                    'name' => 'list_tasks',
                    'description' => 'List tasks from a specific task list within a date or datetime range. Includes overdue tasks when start_date is in the past.',
                    'strict' => true,
                    'parameters' => [
                        'type' => 'object',
                        'properties' => [
                            'task_list_id' => ['type' => 'string', 'description' => 'Google Tasks task list ID'],
                            'start_date' => ['type' => 'string', 'description' => 'ISO 8601 date or datetime (local timezone)'],
                            'end_date' => ['type' => 'string', 'description' => 'ISO 8601 date or datetime (local timezone)'],
                        ],
                        'required' => ['task_list_id', 'start_date', 'end_date'],
                        'additionalProperties' => false,
                    ],
                ],
            ],
            [
                'type' => 'function',
                'function' => [
                    'name' => 'create_task',
                    'description' => 'Create a new task in a Google Tasks list.',
                    'strict' => true,
                    'parameters' => [
                        'type' => 'object',
                        'properties' => [
                            'task_list_id' => ['type' => 'string'],
                            'title' => ['type' => 'string'],
                            'notes' => ['type' => ['string', 'null']],
                            'due_date' => ['type' => ['string', 'null'], 'description' => 'ISO 8601 date (time doesnt matter - gets stripped)'],
                        ],
                        'required' => ['task_list_id', 'title', 'notes', 'due_date'],
                        'additionalProperties' => false,
                    ],
                ],
            ],
            [
                'type' => 'function',
                'function' => [
                    'name' => 'update_task',
                    'description' => 'Update an existing task.',
                    'strict' => true,
                    'parameters' => [
                        'type' => 'object',
                        'properties' => [
                            'task_list_id' => ['type' => 'string'],
                            'task_id' => ['type' => 'string'],
                            'title' => ['type' => ['string', 'null']],
                            'notes' => ['type' => ['string', 'null']],
                            'due_date' => ['type' => ['string', 'null'], 'description' => 'ISO 8601 date (time doesnt matter - gets stripped)'],
                            'completed' => ['type' => ['boolean', 'null']],
                        ],
                        'required' => ['task_list_id', 'task_id', 'title', 'notes', 'due_date', 'completed'],
                        'additionalProperties' => false,
                    ],
                ],
            ],
            [
                'type' => 'function',
                'function' => [
                    'name' => 'list_events',
                    'description' => 'List Google Calendar events within a local time range.',
                    'strict' => true,
                    'parameters' => [
                        'type' => 'object',
                        'properties' => [
                            'start_date' => ['type' => 'string', 'description' => 'ISO 8601 datetime (local timezone)'],
                            'end_date' => ['type' => 'string', 'description' => 'ISO 8601 datetime (local timezone)'],
                        ],
                        'required' => ['start_date', 'end_date'],
                        'additionalProperties' => false,
                    ],
                ],
            ],
            [
                'type' => 'function',
                'function' => [
                    'name' => 'create_event',
                    'description' => 'Create a new calendar event. If start or end time is null, the client resolves the time locally.',
                    'strict' => true,
                    'parameters' => [
                        'type' => 'object',
                        'properties' => [
                            'title' => ['type' => 'string'],
                            'start_datetime' => ['type' => ['string', 'null'], 'description' => 'ISO 8601 datetime (local timezone) or null'],
                            'end_datetime' => ['type' => ['string', 'null'], 'description' => 'ISO 8601 datetime (local timezone) or null'],
                            'location' => ['type' => ['string', 'null']],
                            'notes' => ['type' => ['string', 'null']],
                        ],
                        'required' => ['title', 'start_datetime', 'end_datetime', 'location', 'notes'],
                        'additionalProperties' => false,
                    ],
                ],
            ],
            [
                'type' => 'function',
                'function' => [
                    'name' => 'update_event',
                    'description' => 'Update an existing Google Calendar event. Only provided fields are updated; null values are ignored.',
                    'strict' => true,
                    'parameters' => [
                        'type' => 'object',
                        'properties' => [
                            'event_id' => ['type' => 'string', 'description' => 'ID of the calendar event to update'],
                            'title' => ['type' => ['string', 'null'], 'description' => 'Event title (summary)'],
                            'start_datetime' => ['type' => ['string', 'null'], 'description' => 'ISO 8601 datetime (local timezone) or null'],
                            'end_datetime' => ['type' => ['string', 'null'], 'description' => 'ISO 8601 datetime (local timezone) or null'],
                            'location' => ['type' => ['string', 'null']],
                            'notes' => ['type' => ['string', 'null'], 'description' => 'Event description'],
                        ],
                        'required' => ['event_id'],
                        'additionalProperties' => false,
                    ],
                ],
            ],
        ];
    }
}
