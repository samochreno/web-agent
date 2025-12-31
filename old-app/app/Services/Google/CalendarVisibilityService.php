<?php

namespace App\Services\Google;

use App\Models\GoogleConnection;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;

class CalendarVisibilityService
{
    private const CALENDAR_LIST_TTL_MINUTES = 30;
    private const VISIBLE_SELECTION_TTL_DAYS = 7;

    public function __construct(private readonly GoogleCalendarService $calendarService)
    {
    }

    public function availableCalendars(GoogleConnection $connection): Collection
    {
        return Cache::remember(
            $this->calendarListCacheKey($connection),
            now()->addMinutes(self::CALENDAR_LIST_TTL_MINUTES),
            fn () => $this->calendarService->listCalendars($connection)
                ->filter(fn (array $calendar) => $this->supportsEvents($calendar['access_role'] ?? null))
                ->map(fn (array $calendar) => $this->withReadonlyFlag($calendar))
                ->values()
        );
    }

    public function refreshCalendars(GoogleConnection $connection): Collection
    {
        Cache::forget($this->calendarListCacheKey($connection));

        return $this->availableCalendars($connection);
    }

    public function visibleCalendars(GoogleConnection $connection): Collection
    {
        $available = $this->availableCalendars($connection);
        $visibleIds = $this->visibleCalendarIds($connection, $available);

        return $available
            ->filter(fn (array $calendar) => in_array($calendar['id'], $visibleIds, true))
            ->values();
    }

    public function updateVisibleCalendars(GoogleConnection $connection, array $calendarIds): Collection
    {
        $available = $this->availableCalendars($connection);
        $allowedIds = $available->pluck('id')->all();
        $filtered = array_values(array_unique(array_intersect($calendarIds, $allowedIds)));

        Cache::put(
            $this->visibleCalendarsCacheKey($connection),
            $filtered,
            now()->addDays(self::VISIBLE_SELECTION_TTL_DAYS)
        );

        return $this->visibleCalendars($connection);
    }

    public function isReadonly(GoogleConnection $connection, string $calendarId): bool
    {
        $calendar = $this->availableCalendars($connection)
            ->firstWhere('id', $calendarId);

        if (!$calendar) {
            return true;
        }

        return $this->isReadonlyAccess($calendar['access_role'] ?? null);
    }

    public function isReadonlyAccess(?string $accessRole): bool
    {
        return !in_array($accessRole, ['owner', 'writer'], true);
    }

    private function withReadonlyFlag(array $calendar): array
    {
        return array_merge($calendar, [
            'readonly' => $this->isReadonlyAccess($calendar['access_role'] ?? null),
        ]);
    }

    private function supportsEvents(?string $accessRole): bool
    {
        return in_array($accessRole, ['owner', 'writer', 'reader'], true);
    }

    private function visibleCalendarIds(GoogleConnection $connection, Collection $available): array
    {
        $stored = Cache::get($this->visibleCalendarsCacheKey($connection));

        if (!is_array($stored)) {
            return $this->defaultVisibleIds($available);
        }

        $normalized = array_values(array_intersect($stored, $available->pluck('id')->all()));

        if ($normalized === []) {
            return $this->defaultVisibleIds($available);
        }

        if ($primary = $available->firstWhere('primary', true)) {
            if (!in_array($primary['id'], $normalized, true)) {
                $normalized[] = $primary['id'];
            }
        }

        return $normalized;
    }

    private function defaultVisibleIds(Collection $available): array
    {
        if ($primary = $available->firstWhere('primary', true)) {
            return [$primary['id']];
        }

        return [];
    }

    private function calendarListCacheKey(GoogleConnection $connection): string
    {
        return sprintf('google_calendar:list:%s', $connection->id);
    }

    private function visibleCalendarsCacheKey(GoogleConnection $connection): string
    {
        return sprintf('google_calendar:visible:%s', $connection->id);
    }
}
