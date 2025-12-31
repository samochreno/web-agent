<?php

namespace App\Services\Google;

use App\Models\GoogleConnection;
use Google\Service\Tasks;
use Google\Service\Tasks\Task;
use Google\Service\Tasks\TaskList;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Config;

class GoogleTasksService
{
    public function __construct(private readonly GoogleClientFactory $clientFactory)
    {
    }

    public function listTaskLists(GoogleConnection $connection): Collection
    {
        $client = $this->clientFactory->buildClient($connection);
        $service = new Tasks($client);
        $lists = $service->tasklists->listTasklists();

        return collect($lists->getItems())->map(fn (TaskList $list) => [
            'id' => $list->getId(),
            'title' => $list->getTitle(),
            'name' => $list->getTitle(),
        ]);
    }

    public function prefetchTaskLists(GoogleConnection $connection): array
    {
        return Cache::remember(
            $this->taskListsCacheKey($connection),
            now()->addMinutes(60),
            fn () => $this->listTaskLists($connection)->values()->all()
        );
    }

    public function cachedTaskLists(GoogleConnection $connection): array
    {
        return Cache::get($this->taskListsCacheKey($connection), []);
    }

    public function listTasks(
        GoogleConnection $connection,
        string $taskListId,
        ?Carbon $from = null,
        ?Carbon $to = null
    ): Collection
    {
        $client = $this->clientFactory->buildClient($connection);
        $service = new Tasks($client);
        $tasks = $service->tasks->listTasks($taskListId, [
            'showCompleted' => true,
            'showHidden' => false,
        ]);

        $timezone = Config::get('app.timezone');
        $mapped = collect($tasks->getItems() ?? [])->map(fn (Task $task) => $this->mapTask($task, $timezone));

        if (!$from || !$to) {
            return $mapped;
        }

        $windowStart = $from->copy()->startOfDay();
        $windowEnd = $to->copy()->endOfDay();

        return $mapped
            ->filter(function (array $task) use ($windowStart, $windowEnd, $timezone) {
                if (empty($task['due'])) {
                    return false;
                }

                $due = Carbon::parse($task['due'], $timezone);

                return $due->betweenIncluded($windowStart, $windowEnd);
            })
            ->values();
    }

    public function createTask(
        GoogleConnection $connection,
        string $taskListId,
        string $title,
        ?string $notes,
        ?\DateTimeInterface $due
    ): array {
        $client = $this->clientFactory->buildClient($connection);
        $service = new Tasks($client);
        $task = new Task();
        $task->setTitle($title);
        $task->setNotes($notes);

        if ($due) {
            $task->setDue($due->format(\DateTimeInterface::RFC3339));
        }

        $created = $service->tasks->insert($taskListId, $task);

        return $this->mapTask($created, Config::get('app.timezone'));
    }

    public function updateTask(
        GoogleConnection $connection,
        string $taskListId,
        string $taskId,
        array $payload
    ): array {
        $client = $this->clientFactory->buildClient($connection);
        $service = new Tasks($client);
        $task = new Task();

        if (array_key_exists('title', $payload)) {
            $task->setTitle($payload['title']);
        }

        if (array_key_exists('notes', $payload)) {
            $task->setNotes($payload['notes']);
        }

        if (array_key_exists('due', $payload) && $payload['due'] instanceof \DateTimeInterface) {
            $task->setDue($payload['due']->format(\DateTimeInterface::RFC3339));
        } elseif (array_key_exists('due', $payload) && $payload['due'] === null) {
            // Clearing due is supported via PATCH.
            $task->setDue(null);
        }

        $updated = $service->tasks->patch($taskListId, $taskId, $task);

        return $this->mapTask($updated, Config::get('app.timezone'));
    }

    private function mapTask(Task $task, string $timezone): array
    {
        $due = $task->getDue();

        return [
            'id' => $task->getId(),
            'title' => $task->getTitle(),
            'notes' => $task->getNotes(),
            'status' => $task->getStatus(),
            'due' => $due ? Carbon::parse($due, $timezone)->toDateString() : null,
        ];
    }

    private function taskListsCacheKey(GoogleConnection $connection): string
    {
        return sprintf('google_tasks:task_lists:%s', $connection->id);
    }
}
