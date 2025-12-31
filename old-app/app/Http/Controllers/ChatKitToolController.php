<?php

namespace App\Http\Controllers;

use App\Services\Agent\AgentLoopService;
use App\Services\Google\GoogleOAuthService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Log;

class ChatKitToolController extends Controller
{
    public function __construct(
        private readonly AgentLoopService $agentLoop,
        private readonly GoogleOAuthService $oauthService,
    ) {
    }

    public function store(Request $request): JsonResponse
    {
        if (!Config::get('chatkit.enabled')) {
            abort(404);
        }

        // Capture the raw payload so we can diagnose unexpected shapes from ChatKit.
        $rawBody = $request->all();
        Log::info('ChatKit tool request received', [
            'body' => $rawBody,
        ]);

        $data = $request->validate([
            'name' => ['required', 'string'],
            // Allow raw strings/objects; we'll normalize below.
            'arguments' => ['nullable'],
        ]);

        $connection = $this->oauthService->forSession($request, $request->user());

        if (!$connection) {
            return response()->json([
                'error' => 'Google is not connected.',
            ], 403);
        }

        // Prefer a few common keys before falling back to the validated "arguments".
        $rawArguments = $request->input('arguments');
        $rawArguments ??= $request->input('args');
        $rawArguments ??= $request->input('parameters');
        $rawArguments ??= $request->input('params');
        $rawArguments ??= $data['arguments'] ?? null;
        $arguments = $this->normalizeArguments($rawArguments);

        Log::debug('ChatKit tool call', [
            'name' => $data['name'],
            'raw_type' => gettype($rawArguments),
            'raw_keys' => is_array($rawArguments) ? array_keys($rawArguments) : null,
            'normalized_keys' => array_keys($arguments),
            'request_keys' => array_keys($rawBody),
            'content_type' => $request->header('content-type'),
        ]);

        try {
            $result = $this->agentLoop->executeTool(
                $data['name'],
                $arguments,
                $connection
            );
        } catch (\Throwable $e) {
            return response()->json([
                'error' => $e->getMessage(),
            ], 422);
        }

        return response()->json([
            'result' => $result,
        ]);
    }

    /**
     * Normalize ChatKit tool arguments so the agent always receives a flat associative array.
     */
    private function normalizeArguments(mixed $arguments): array
    {
        $normalized = $this->forceArray($arguments);

        // Unwrap common nesting keys (ChatKit sometimes nests under "arguments", "payload", etc.)
        foreach (['arguments', 'payload', 'data', 'input', 'tool', 'body'] as $wrapper) {
            if (is_array($normalized) && array_key_exists($wrapper, $normalized)) {
                $normalized = $this->forceArray($normalized[$wrapper]);
            }
        }

        if (!is_array($normalized)) {
            return [];
        }

        // Convert a list of key/value objects into an associative array.
        if (Arr::isList($normalized)) {
            $assoc = [];

            foreach ($normalized as $item) {
                if (!is_array($item)) {
                    continue;
                }

                if (array_key_exists('name', $item) || array_key_exists('key', $item) || array_key_exists('field', $item)) {
                    $k = $item['name'] ?? $item['key'] ?? $item['field'];
                    $v = $item['value'] ?? ($item['val'] ?? ($item['v'] ?? null));

                    if ($k !== null && $v !== null) {
                        $assoc[$k] = $v;
                    }
                    continue;
                }

                if (!Arr::isList($item)) {
                    $assoc = array_merge($assoc, $item);
                }
            }

            if (!empty($assoc)) {
                $normalized = $assoc;
            }
        }

        return $normalized;
    }

    private function forceArray(mixed $value): array
    {
        if (is_string($value)) {
            $decoded = json_decode($value, true);

            if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
                return $decoded;
            }

            return [];
        }

        if (is_object($value)) {
            $value = json_decode(json_encode($value), true);

            if (json_last_error() === JSON_ERROR_NONE && is_array($value)) {
                return $value;
            }

            return [];
        }

        if (is_array($value)) {
            return $value;
        }

        return [];
    }
}
