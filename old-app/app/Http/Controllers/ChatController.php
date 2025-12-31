<?php

namespace App\Http\Controllers;

use App\Http\Requests\ChatMessageRequest;
use App\Services\Agent\AliasService;
use App\Services\Chat\ChatKitClient;
use App\Services\Chat\ChatKitSessionService;
use App\Services\Chat\ChatKitStateService;
use App\Services\Chat\ChatSessionManager;
use App\Services\Google\GoogleTasksService;
use App\Services\Google\GoogleOAuthService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;
use GuzzleHttp\Exception\ClientException;

class ChatController extends Controller
{
    private const CLIENT_SECRET_KEY = 'chat.chatkit_client_secret';
    private const CLIENT_SECRET_FINGERPRINT_KEY = 'chat.chatkit_client_secret_fingerprint';

    public function __construct(
        private readonly AliasService $aliasService,
        private readonly ChatKitClient $chatKitClient,
        private readonly ChatKitSessionService $chatKitSessionService,
        private readonly ChatKitStateService $chatKitStateService,
        private readonly ChatSessionManager $sessionManager,
        private readonly GoogleOAuthService $oauthService,
        private readonly GoogleTasksService $tasksService,
    ) {
    }

    public function index(Request $request): Response
    {
        $connection = $this->oauthService->forSession($request, $request->user());

        return Inertia::render('Chat', [
            'google' => [
                'connected' => (bool) $connection,
                'email' => $connection?->email,
                'authUrl' => config('google.client_id') && config('google.client_secret')
                    ? route('google.redirect')
                    : null,
            ],
            'chatkit' => [
                'enabled' => (bool) config('chatkit.enabled'),
                'workflowId' => config('chatkit.workflow_id'),
                'runtimeEndpoint' => config('chatkit.runtime_endpoint', 'https://api.openai.com/v1/chat/completions'),
                'organization' => $this->validOrganization(),
            ],
            'conversation' => $this->sessionManager->history(),
            'settingsUrl' => route('chat.settings'),
            'openaiKey' => config('services.openai.api_key'),
        ]);
    }

    public function settings(Request $request): Response
    {
        $connection = $this->oauthService->forSession($request, $request->user());

        if ($connection) {
            try {
                $this->tasksService->prefetchTaskLists($connection);
            } catch (\Throwable $e) {
                Log::warning('Unable to prefetch Google task lists for Chat settings', [
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return Inertia::render('ChatSettings', [
            'google' => [
                'connected' => (bool) $connection,
                'email' => $connection?->email,
                'authUrl' => config('google.client_id') && config('google.client_secret')
                    ? route('google.redirect')
                    : null,
            ],
            'chatkit' => [
                'enabled' => (bool) config('chatkit.enabled'),
                'workflowId' => config('chatkit.workflow_id'),
                'workflowVersion' => config('chatkit.workflow_version'),
                'openaiConfigured' => (bool) config('services.openai.api_key'),
            ],
        ]);
    }

    private function validOrganization(): ?string
    {
        $organization = config('services.openai.organization');

        if (!$organization) {
            return null;
        }

        if (!str_starts_with($organization, 'org_') && !str_starts_with($organization, 'org-')) {
            return null;
        }

        return $organization;
    }

    public function store(ChatMessageRequest $request): StreamedResponse|JsonResponse
    {
        if (!config('chatkit.enabled')) {
            return response()->json([
                'message' => 'Agent Builder is not enabled.',
            ], 503);
        }

        if (!config('services.openai.api_key')) {
            return response()->json([
                'message' => 'OpenAI is not configured yet. Please add OPENAI_API_KEY to continue.',
            ], 503);
        }

        if (!config('chatkit.workflow_id')) {
            return response()->json([
                'message' => 'Agent Builder workflow ID is not configured.',
            ], 503);
        }

        $connection = $this->oauthService->forSession($request, $request->user());
        $clientSecret = $this->clientSecret($request, $connection);

        if (!$clientSecret) {
            return response()->json([
                'message' => 'Unable to start chat session right now. Please try again.',
            ], 503);
        }

        $message = $request->string('message');
        $this->sessionManager->append('user', $message);

        $headers = [
            'Cache-Control' => 'no-cache',
            'Content-Type' => 'text/event-stream',
            'X-Accel-Buffering' => 'no',
        ];

        return response()->stream(function () use (&$clientSecret, $connection, $message, $request) {
            $messages = [
                ['role' => 'user', 'content' => $message],
            ];

            $sendError = function (string $errorMessage): void {
                echo 'data: ' . json_encode(['error' => $errorMessage]) . "\n\n";
            };

            $attempt = 0;

            while ($attempt < 2) {
                $assistantReply = '';

                try {
                    foreach ($this->chatKitClient->streamText($clientSecret, $messages) as $event) {
                        if (!empty($event['delta'])) {
                            $assistantReply .= $event['delta'];
                        }

                        echo 'data: ' . json_encode($event) . "\n\n";
                        @ob_flush();
                        flush();
                    }

                    if ($assistantReply !== '') {
                        $this->sessionManager->append('assistant', $assistantReply);
                    }

                    return;
                } catch (ClientException $e) {
                    $status = $e->getResponse()?->getStatusCode();
                    $isUnauthorized = $status === 401;

                    Log::error('ChatKit streaming failed', [
                        'error' => $e->getMessage(),
                        'status' => $status,
                    ]);

                    if ($isUnauthorized && $attempt === 0) {
                        $request->session()->forget(self::CLIENT_SECRET_KEY);
                        $clientSecret = $this->clientSecret($request, $connection);
                        $attempt++;

                        if ($clientSecret) {
                            continue;
                        }
                    }

                    $sendError('We could not reach the assistant. Please try again.');
                    return;
                } catch (\Throwable $e) {
                    Log::error('ChatKit streaming failed', [
                        'error' => $e->getMessage(),
                    ]);

                    $sendError('We could not reach the assistant. Please try again.');
                    return;
                }
            }
        }, 200, $headers);
    }

    public function reset(Request $request): RedirectResponse
    {
        $this->sessionManager->reset();
        $this->aliasService->reset();
        $request->session()->forget(self::CLIENT_SECRET_KEY);
        $request->session()->forget(self::CLIENT_SECRET_FINGERPRINT_KEY);

        return redirect()->route('chat.index');
    }

    private function clientSecret(Request $request, $connection): ?string
    {
        $apiKey = config('services.openai.api_key');
        $workflowId = config('chatkit.workflow_id');
        $workflowVersion = config('chatkit.workflow_version');
        $organization = $this->validOrganization();

        if (!$apiKey || !$workflowId) {
            return null;
        }

        // Fingerprint ensures we rotate the client secret whenever credentials or workflow change.
        $fingerprint = hash('sha256', implode('|', [
            $apiKey,
            $workflowId,
            $workflowVersion ?? 'noversion',
            $organization ?? 'noorg',
        ]));

        $secret = $request->session()->get(self::CLIENT_SECRET_KEY);
        $storedFingerprint = $request->session()->get(self::CLIENT_SECRET_FINGERPRINT_KEY);

        if ($secret && $storedFingerprint === $fingerprint) {
            return $secret;
        }

        try {
            $this->aliasService->reset();
            $session = $this->chatKitSessionService->create(
                $request->user()?->getAuthIdentifier() ?? $request->session()->getId(),
                $this->chatKitStateService->variables($connection)
            );

            $secret = $session['client_secret'] ?? null;
            $request->session()->put(self::CLIENT_SECRET_KEY, $secret);
            $request->session()->put(self::CLIENT_SECRET_FINGERPRINT_KEY, $fingerprint);
        } catch (\Throwable $e) {
            Log::error('Unable to create ChatKit session', [
                'error' => $e->getMessage(),
            ]);

            return null;
        }

        return $secret;
    }
}
