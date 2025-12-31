<?php

namespace App\Services\Scheduling;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Config;

class SchedulingResolver
{
    public function resolveEventWindow(?string $date, ?string $start, ?string $end): array
    {
        $timezone = Config::get('app.timezone');
        $day = Carbon::parse($date ?? now($timezone)->toDateString(), $timezone);
        $startTime = $start
            ? Carbon::parse($start, $timezone)
            : $day->copy()->setTimeFromTimeString(Config::get('google.event_defaults.start_time', '09:00'));

        $endTime = $end
            ? Carbon::parse($end, $timezone)
            : $startTime->copy()->addMinutes(Config::get('google.event_defaults.duration_minutes', 60));

        return [$startTime, $endTime];
    }
}
