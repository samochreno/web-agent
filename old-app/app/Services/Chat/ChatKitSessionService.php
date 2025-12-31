<?php

namespace App\Services\Chat;

use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class ChatKitSessionService
{
    public function create(string $userIdentifier, array $stateVariables = []): array
    {
        $workflowId = Config::get('chatkit.workflow_id');
        $apiKey = Config::get('services.openai.api_key');
        $endpoint = Config::get('chatkit.session_endpoint', 'https://api.openai.com/v1/chatkit/sessions');

        if (!$workflowId) {
            throw new \RuntimeException('ChatKit workflow ID is not configured.');
        }

        if (!$apiKey) {
            throw new \RuntimeException('OpenAI API key is not configured.');
        }

        $organization = Config::get('services.openai.organization');

        // Only pass the organization header when it looks like an actual org ID.
        if ($organization && !str_starts_with($organization, 'org_') && !str_starts_with($organization, 'org-')) {
            $organization = null;
        }

        $workflow = array_filter([
            'id' => $workflowId,
            'version' => Config::get('chatkit.workflow_version'),
            'state_variables' => empty($stateVariables) ? null : $stateVariables,
        ]);

        $payload = array_filter([
            'workflow' => $workflow,
            'user' => $userIdentifier,
        ]);

        $response = Http::withHeaders(array_filter([
            'OpenAI-Beta' => 'chatkit_beta=v1',
            'OpenAI-Organization' => $organization,
        ]))
        ->withToken($apiKey)
        ->post($endpoint, $payload);

        if ($response->failed()) {
            Log::error('Failed to create ChatKit session', [
                'status' => $response->status(),
                'body' => $response->json(),
            ]);

            throw new \RuntimeException('Unable to create ChatKit session.');
        }

        return $response->json();
    }
}
