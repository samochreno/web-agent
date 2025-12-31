<?php

namespace App\Services\Google;

use App\Models\GoogleConnection;
use Google\Service\Oauth2;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class GoogleOAuthService
{
    public function __construct(private readonly GoogleClientFactory $clientFactory)
    {
    }

    public function getAuthorizationUrl(Request $request): string
    {
        if (!config('google.client_id') || !config('google.client_secret')) {
            return '#';
        }

        $client = $this->clientFactory->buildClient();
        $state = Str::uuid()->toString();
        $request->session()->put('google_oauth_state', $state);

        $client->setState($state);

        return $client->createAuthUrl();
    }

    public function handleCallback(Request $request, ?Authenticatable $user = null): GoogleConnection
    {
        $expectedState = $request->session()->pull('google_oauth_state');
        if ($expectedState && $expectedState !== $request->string('state')) {
            abort(403, 'Invalid OAuth state');
        }

        $client = $this->clientFactory->buildClient();
        $token = $client->fetchAccessTokenWithAuthCode($request->string('code'));

        if (isset($token['error'])) {
            Log::error('Google OAuth error', ['error' => $token['error']]);
            abort(400, $token['error_description'] ?? 'Unable to authenticate with Google');
        }

        $client->setAccessToken($token);
        $oauthService = new Oauth2($client);
        $profile = $oauthService->userinfo->get();

        return GoogleConnection::updateOrCreate(
            [
                'session_id' => $request->session()->getId(),
                'user_id' => $user?->getAuthIdentifier(),
            ],
            [
                'email' => $profile->getEmail(),
                'access_token' => $token['access_token'] ?? '',
                'refresh_token' => $token['refresh_token'] ?? null,
                'token_type' => $token['token_type'] ?? 'Bearer',
                'scope' => $token['scope'] ?? null,
                'expires_at' => isset($token['expires_in']) ? now()->addSeconds($token['expires_in']) : null,
            ]
        );
    }

    public function disconnect(Request $request, ?Authenticatable $user = null): void
    {
        GoogleConnection::query()
            ->where('session_id', $request->session()->getId())
            ->when($user, fn ($query) => $query->orWhere('user_id', $user->getAuthIdentifier()))
            ->delete();
    }

    public function forSession(Request $request, ?Authenticatable $user = null): ?GoogleConnection
    {
        return GoogleConnection::query()
            ->where('session_id', $request->session()->getId())
            ->when($user, fn ($query) => $query->orWhere('user_id', $user->getAuthIdentifier()))
            ->latest()
            ->first();
    }
}
