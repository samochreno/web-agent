<?php

namespace App\Services\Chat;

use Generator;
use GuzzleHttp\Client;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Config;

class ChatKitClient
{
    public function __construct(private readonly Client $http)
    {
    }

    /**
     * Stream ChatKit text deltas as associative arrays: ['delta' => '...'] or ['done' => true].
     */
    public function streamText(string $clientSecret, array $messages): Generator
    {
        $endpoint = Config::get('chatkit.runtime_endpoint', 'https://api.openai.com/v1/chat/completions');
        $workflowId = Config::get('chatkit.workflow_id');

        $headers = [
            'Authorization' => "Bearer {$clientSecret}",
            'Content-Type' => 'application/json',
            'OpenAI-Beta' => 'chatkit_beta=v1',
        ];

        $response = $this->http->post($endpoint, [
            'headers' => $headers,
            'json' => array_filter([
                'model' => $workflowId,
                'messages' => $messages,
                'stream' => true,
            ]),
            'stream' => true,
        ]);

        $body = $response->getBody();
        $buffer = '';
        $streamFinished = false;

        while (!$body->eof()) {
            $buffer .= $body->read(1024);

            if ($buffer === '') {
                continue;
            }

            while (($delimiterPosition = strpos($buffer, "\n\n")) !== false) {
                $rawEvent = trim(substr($buffer, 0, $delimiterPosition));
                $buffer = substr($buffer, $delimiterPosition + 2);

                if ($rawEvent === '' || !str_starts_with($rawEvent, 'data:')) {
                    continue;
                }

                $payload = trim(substr($rawEvent, 5));

                if ($payload === '[DONE]') {
                    $streamFinished = true;
                    yield ['done' => true];
                    continue;
                }

                $decoded = json_decode($payload, true);

                if (!is_array($decoded)) {
                    continue;
                }

                $delta = Arr::get($decoded, 'choices.0.delta.content');

                if ($delta !== null) {
                    yield ['delta' => $delta];
                }
            }
        }

        if (!$streamFinished) {
            yield ['done' => true];
        }
    }
}
