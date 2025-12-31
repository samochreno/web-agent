<?php

namespace App\Services\Agent;

use Illuminate\Session\Store;
use Illuminate\Support\Arr;
use Illuminate\Support\Collection;

/**
 * Maintains numeric aliases for Google resources (task lists, tasks, events) within a session.
 */
class AliasService
{
    private const SESSION_KEY = 'agent.aliases';

    public function __construct(private readonly Store $session)
    {
    }

    public function reset(): void
    {
        $this->store($this->freshState());
    }

    public function registerCalendar(string $calendarId, ?string $accessRole = null): string
    {
        return $this->register([
            'type' => 'calendar',
            'calendar_id' => $calendarId,
            'access_role' => $accessRole,
        ]);
    }

    public function registerTaskList(string $taskListId): string
    {
        return $this->register([
            'type' => 'task_list',
            'task_list_id' => $taskListId,
        ]);
    }

    public function registerTask(string $taskListId, string $taskId): string
    {
        return $this->register([
            'type' => 'task',
            'task_list_id' => $taskListId,
            'task_id' => $taskId,
        ]);
    }

    public function registerEvent(string $eventId, string $calendarId = 'primary', bool $readonly = false): string
    {
        return $this->register([
            'type' => 'event',
            'event_id' => $eventId,
            'calendar_id' => $calendarId,
            'readonly' => $readonly,
        ]);
    }

    public function resolveCalendar(string $aliasOrReal): string
    {
        $payload = $this->payload($aliasOrReal);

        if ($payload && $payload['type'] === 'calendar') {
            return $payload['calendar_id'];
        }

        return $aliasOrReal;
    }

    public function resolveTaskList(string $aliasOrReal): string
    {
        $payload = $this->payload($aliasOrReal);

        if ($payload && $payload['type'] === 'task_list') {
            return $payload['task_list_id'];
        }

        return $aliasOrReal;
    }

    public function resolveTask(string $taskListIdOrAlias, string $taskIdOrAlias): array
    {
        $taskListId = $this->resolveTaskList($taskListIdOrAlias);
        $payload = $this->payload($taskIdOrAlias);

        if ($payload && $payload['type'] === 'task') {
            return [$payload['task_list_id'], $payload['task_id']];
        }

        return [$taskListId, $taskIdOrAlias];
    }

    public function resolveEvent(string $eventIdOrAlias, string $defaultCalendarId = 'primary'): array
    {
        $payload = $this->payload($eventIdOrAlias);

        if ($payload && $payload['type'] === 'event') {
            return [$payload['calendar_id'] ?? $defaultCalendarId, $payload['event_id']];
        }

        return [$defaultCalendarId, $eventIdOrAlias];
    }

    public function maskCalendars(Collection $calendars): Collection
    {
        return $calendars->map(fn (array $calendar) => $this->maskCalendar($calendar));
    }

    public function maskCalendar(array $calendar): array
    {
        $alias = $this->registerCalendar($calendar['id'], $calendar['access_role'] ?? null);

        return array_merge(Arr::except($calendar, ['id', 'calendar_id']), ['id' => $alias]);
    }

    public function maskTaskLists(Collection $lists): Collection
    {
        return $lists->map(function (array $list) {
            return [
                'id' => $this->registerTaskList($list['id']),
                'title' => $list['title'],
            ];
        });
    }

    public function maskTasks(Collection $tasks, string $taskListId): Collection
    {
        return $tasks->map(fn (array $task) => $this->maskTask($task, $taskListId));
    }

    public function maskTask(array $task, string $taskListId): array
    {
        $alias = $this->registerTask($taskListId, $task['id']);

        return array_merge(Arr::except($task, ['id']), ['id' => $alias]);
    }

    public function maskEvents(Collection $events, ?string $calendarId = null): Collection
    {
        return $events->map(function (array $event) use ($calendarId) {
            $targetCalendarId = $event['calendar_id'] ?? $calendarId ?? 'primary';

            return $this->maskEvent($event, $targetCalendarId);
        });
    }

    public function maskEvent(array $event, string $calendarId = 'primary'): array
    {
        $readonly = (bool) ($event['readonly'] ?? false);
        $alias = $this->registerEvent($event['id'], $calendarId, $readonly);

        return array_merge(
            Arr::except($event, ['id', 'calendar_id']),
            [
                'id' => $alias,
                'readonly' => $readonly,
            ]
        );
    }

    public function eventIsReadonly(string $eventAlias): bool
    {
        $payload = $this->payload($eventAlias);

        if ($payload && $payload['type'] === 'event') {
            return (bool) ($payload['readonly'] ?? false);
        }

        return false;
    }

    private function payload(string $alias): ?array
    {
        $state = $this->state();

        return $state['aliases'][$alias] ?? null;
    }

    private function register(array $payload): string
    {
        $state = $this->state();
        $key = $this->payloadKey($payload);

        if (isset($state['reverse'][$key])) {
            return $state['reverse'][$key];
        }

        $alias = (string) (++$state['counter']);
        $state['aliases'][$alias] = $payload;
        $state['reverse'][$key] = $alias;

        $this->store($state);

        return $alias;
    }

    private function payloadKey(array $payload): string
    {
        $keyPayload = $payload;

        if (($keyPayload['type'] ?? null) === 'event') {
            unset($keyPayload['readonly']);
        }

        if (($keyPayload['type'] ?? null) === 'calendar') {
            unset($keyPayload['access_role']);
        }

        ksort($keyPayload);

        return json_encode($keyPayload);
    }

    private function state(): array
    {
        return $this->session->get(self::SESSION_KEY, $this->freshState());
    }

    private function store(array $state): void
    {
        $this->session->put(self::SESSION_KEY, $state);
    }

    private function freshState(): array
    {
        return [
            'counter' => 0,
            'aliases' => [],
            'reverse' => [],
        ];
    }
}
