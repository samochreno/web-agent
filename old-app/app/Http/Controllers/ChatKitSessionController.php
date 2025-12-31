<?php

namespace App\Http\Controllers;

use App\Services\Chat\ChatKitSessionService;
use App\Services\Chat\ChatKitStateService;
use App\Services\Google\GoogleOAuthService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Log;

class ChatKitSessionController extends Controller
{
    public function __construct(
        private readonly ChatKitSessionService $sessionService,
        private readonly GoogleOAuthService $oauthService,
        private readonly ChatKitStateService $stateService,
    ) {
    }

    public function store(Request $request): JsonResponse
    {
        if (!Config::get('chatkit.enabled')) {
            abort(404);
        }

        $connection = $this->oauthService->forSession($request, $request->user());
        $userIdentifier = $request->user()?->getAuthIdentifier() ?? $request->session()->getId();

        try {
            $session = $this->sessionService->create(
                $userIdentifier,
                $this->stateService->variables($connection)
            );
        } catch (\Throwable $e) {
            Log::error('Unable to start ChatKit session', [
                'message' => $e->getMessage(),
            ]);

            return response()->json([
                'message' => 'Unable to start chat session right now. Please try again.',
            ], 503);
        }

        return response()->json([
            'client_secret' => $session['client_secret'] ?? null,
        ]);
    }
}
