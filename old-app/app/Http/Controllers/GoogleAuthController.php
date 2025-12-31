<?php

namespace App\Http\Controllers;

use App\Services\Google\GoogleOAuthService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class GoogleAuthController extends Controller
{
    public function __construct(private readonly GoogleOAuthService $oauthService)
    {
    }

    public function redirect(Request $request): RedirectResponse
    {
        return redirect()->away($this->oauthService->getAuthorizationUrl($request));
    }

    public function callback(Request $request): RedirectResponse
    {
        $this->oauthService->handleCallback($request, $request->user());

        return redirect()->route('chat.index')->with('status', 'Connected to Google.');
    }

    public function disconnect(Request $request): RedirectResponse
    {
        $this->oauthService->disconnect($request, $request->user());

        return redirect()->route('chat.index')->with('status', 'Google disconnected.');
    }
}
