<?php

namespace App\Http\Controllers;

use App\Services\Agent\AliasService;
use App\Services\Google\CalendarVisibilityService;
use App\Services\Google\GoogleOAuthService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class CalendarController extends Controller
{
    public function __construct(
        private readonly GoogleOAuthService $oauthService,
        private readonly CalendarVisibilityService $calendarVisibilityService,
        private readonly AliasService $aliasService,
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        $connection = $this->oauthService->forSession($request, $request->user());

        if (!$connection) {
            return response()->json([
                'error' => 'Google is not connected.',
            ], 403);
        }

        try {
            $available = $this->calendarVisibilityService->availableCalendars($connection);
            $visible = $this->calendarVisibilityService->visibleCalendars($connection);
        } catch (\Throwable $e) {
            Log::warning('Unable to load calendars', ['error' => $e->getMessage()]);

            return response()->json([
                'error' => 'Unable to load calendars right now.',
            ], 503);
        }

        $visibleIds = $visible->pluck('id')->all();

        $calendars = $available->map(function (array $calendar) use ($visibleIds) {
            $calendar['selected'] = in_array($calendar['id'], $visibleIds, true);

            return $calendar;
        });

        return response()->json([
            'calendars' => $this->aliasService->maskCalendars($calendars),
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        $connection = $this->oauthService->forSession($request, $request->user());

        if (!$connection) {
            return response()->json([
                'error' => 'Google is not connected.',
            ], 403);
        }

        $data = $request->validate([
            'calendars' => ['array'],
            'calendars.*' => ['string'],
        ]);

        $selectedAliases = collect($data['calendars'] ?? [])
            ->filter(fn ($id) => is_string($id))
            ->values();

        $selectedIds = $selectedAliases
            ->map(fn (string $alias) => $this->aliasService->resolveCalendar($alias))
            ->all();

        try {
            $visible = $this->calendarVisibilityService->updateVisibleCalendars($connection, $selectedIds);
            $available = $this->calendarVisibilityService->availableCalendars($connection);
        } catch (\Throwable $e) {
            Log::warning('Unable to update visible calendars', ['error' => $e->getMessage()]);

            return response()->json([
                'error' => 'Unable to save calendar visibility right now.',
            ], 503);
        }

        $visibleIds = $visible->pluck('id')->all();

        $calendars = $available->map(function (array $calendar) use ($visibleIds) {
            $calendar['selected'] = in_array($calendar['id'], $visibleIds, true);

            return $calendar;
        });

        return response()->json([
            'calendars' => $this->aliasService->maskCalendars($calendars),
        ]);
    }
}

