<?php

namespace App\Providers;

use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Vite;
use Illuminate\Support\ServiceProvider;
use OpenAI;
use OpenAI\Client;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->bind(Client::class, function () {
            return OpenAI::client(
                Config::get('services.openai.api_key') ?? '',
                Config::get('services.openai.organization') ?: null
            );
        });
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        Vite::prefetch(concurrency: 3);
    }
}
