<?php

namespace App\Services\Chat;

use App\Models\GoogleConnection;
use App\Services\Google\GoogleTasksService;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Log;

class ChatKitStateService
{
    public function __construct(private readonly GoogleTasksService $tasksService)
    {
    }

    public function variables(?GoogleConnection $connection): array
    {
        $now = now(Config::get('app.timezone'));
        $taskLists = [];

        if ($connection) {
            try {
                $taskLists = $this->tasksService->cachedTaskLists($connection);

                if (empty($taskLists)) {
                    $taskLists = $this->tasksService->prefetchTaskLists($connection);
                }
            } catch (\Throwable $e) {
                Log::warning('Unable to load cached Google task lists for state variables', [
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return array_filter([
            'date' => $now->toDateString(),
            'time' => $now->format('H:i'),
            'day' => $now->format('l'),
            'tasklists' => $this->encodeTaskLists($taskLists),
        ], fn ($value) => $value !== null);
    }

    private function encodeTaskLists(array $taskLists): ?string
    {
        $normalized = collect($taskLists)
            ->map(function (array $list) {
                return [
                    'id' => $list['id'] ?? null,
                    'name' => $list['name'] ?? $list['title'] ?? null,
                ];
            })
            ->filter(fn ($list) => $list['id'] && $list['name'])
            ->values()
            ->all();

        if (empty($normalized)) {
            return null;
        }

        return json_encode($normalized);
    }
}
