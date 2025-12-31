<?php

namespace App\Services\Chat;

use Illuminate\Http\Request;

class ChatSessionManager
{
    private const SESSION_KEY = 'chat.conversation';

    public function __construct(private readonly Request $request)
    {
    }

    public function history(): array
    {
        return $this->request->session()->get(self::SESSION_KEY, []);
    }

    public function append(string $role, string $content): void
    {
        $this->appendMessage(['role' => $role, 'content' => $content]);
    }

    public function appendMessage(array $message): void
    {
        $messages = $this->history();
        $messages[] = $message;
        $this->request->session()->put(self::SESSION_KEY, $messages);
    }

    public function reset(): void
    {
        $this->request->session()->forget(self::SESSION_KEY);
    }
}
