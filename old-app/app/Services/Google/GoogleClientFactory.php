<?php

namespace App\Services\Google;

use App\Models\GoogleConnection;
use Google\Client as GoogleClient;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Log;

class GoogleClientFactory
{
    public function buildClient(?GoogleConnection $connection = null): GoogleClient
    {
        $client = new GoogleClient();
        $client->setApplicationName(Config::get('app.name', 'Assistant'));
        $client->setClientId(Config::get('google.client_id'));
        $client->setClientSecret(Config::get('google.client_secret'));
        $client->setRedirectUri(Config::get('google.redirect_uri'));
        $client->setScopes(Config::get('google.scopes', []));
        $client->setAccessType('offline');
        $client->setPrompt('consent');

        if ($connection) {
            $client->setAccessToken([
                'access_token' => $connection->access_token,
                'expires_in' => $connection->expires_at ? max($connection->expires_at->diffInSeconds(now()), 0) : null,
                'refresh_token' => $connection->refresh_token,
                'scope' => $connection->scope,
                'token_type' => $connection->token_type,
                'created' => $connection->created_at?->timestamp,
            ]);

            if ($client->isAccessTokenExpired() && $connection->refresh_token) {
                try {
                    $token = $client->fetchAccessTokenWithRefreshToken($connection->refresh_token);
                    $connection->update([
                        'access_token' => $token['access_token'] ?? $connection->access_token,
                        'expires_at' => isset($token['expires_in']) ? now()->addSeconds($token['expires_in']) : $connection->expires_at,
                        'scope' => $token['scope'] ?? $connection->scope,
                        'token_type' => $token['token_type'] ?? $connection->token_type,
                    ]);
                } catch (\Throwable $e) {
                    Log::warning('Unable to refresh Google token', ['error' => $e->getMessage()]);
                }
            }
        }

        return $client;
    }
}
