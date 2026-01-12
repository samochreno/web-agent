import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRealtimeConnection } from "../lib/realtimeConnection";
import { callRealtimeTool, createRealtimeSession } from "../lib/api";
import { realtimeTools } from "../lib/realtimeTools";
import type { ConnectionState } from "../types";

const DEFAULT_API_BASE =
  (import.meta.env.VITE_REALTIME_API_BASE as string | undefined) ||
  "https://api.openai.com";

const CONNECTION_STATES = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
} as const;

type MessageRole = "user" | "assistant" | "tool";

type ConversationMessage = {
  id: string;
  role: MessageRole;
  text: string;
  status: "in_progress" | "done";
  toolResult?: unknown;
};

type Props = {
  className?: string;
  promptId?: string;
  onConnectionStateChange?: (state: ConnectionState) => void;
  onOutputAudioBufferActiveChange?: (active: boolean) => void;
  onConnectionHandlersReady?: (handlers: {
    connect: () => void;
    disconnect: () => void;
  }) => void;
};

type ServerEvent = {
  type: string;
  item?: {
    id?: string;
    role?: string;
    content?: { text?: string; transcript?: string }[];
  };
  item_id?: string;
  transcript?: string | null;
  delta?: string;
  response?: {
    output?: Array<{
      id: string;
      type?: string;
      name?: string;
      arguments?: unknown;
      call_id?: string;
      role?: string;
      content?: Array<{ transcript?: string; text?: string }>;
    }>;
  };
};

type FunctionCallPayload = {
  name: string;
  call_id?: string;
  arguments: unknown;
};

function deriveApiBase(urlFromSession?: string | null): string {
  if (!urlFromSession) return DEFAULT_API_BASE;
  try {
    const parsed = new URL(urlFromSession);
    if (parsed.protocol.startsWith("ws")) {
      parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
      return parsed.origin;
    }
    return parsed.origin;
  } catch (err) {
    console.warn("Unable to parse realtime url, using default", err);
    return DEFAULT_API_BASE;
  }
}

export function RealtimePanel({
  className,
  promptId,
  onConnectionStateChange,
  onOutputAudioBufferActiveChange,
  onConnectionHandlersReady,
}: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const cleanupRef = useRef<() => void>(() => {});
  const connectAttemptRef = useRef(0);
  const connectAbortControllerRef = useRef<AbortController | null>(null);
  const hasAutoConnectedRef = useRef(false);

  const [connectionState, setConnectionStateInternal] =
    useState<ConnectionState>(CONNECTION_STATES.DISCONNECTED);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [
    isOutputAudioBufferActiveInternal,
    setIsOutputAudioBufferActiveInternal,
  ] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [inputText, setInputText] = useState("");

  // Wrapper to sync state with parent
  const setConnectionState = useCallback(
    (state: ConnectionState) => {
      setConnectionStateInternal(state);
      onConnectionStateChange?.(state);
    },
    [onConnectionStateChange]
  );

  const setIsOutputAudioBufferActive = useCallback(
    (active: boolean) => {
      setIsOutputAudioBufferActiveInternal(active);
      onOutputAudioBufferActiveChange?.(active);
    },
    [onOutputAudioBufferActiveChange]
  );

  const resolvedPromptId = promptId;

  const shouldAutoConnect = import.meta.env.PROD;

  const addOrUpdateMessage = useCallback(
    (
      id: string,
      role: MessageRole,
      text: string,
      status: "in_progress" | "done" = "in_progress"
    ) => {
      setMessages((prev) => {
        const existing = prev.find((m) => m.id === id);
        if (existing) {
          return prev.map((m) =>
            m.id === id ? { ...m, role, text, status } : m
          );
        }
        return [...prev, { id, role, text, status }];
      });
    },
    []
  );

  const appendAssistantText = useCallback((id: string, delta: string) => {
    setMessages((prev) => {
      const existing = prev.find((m) => m.id === id);
      if (existing) {
        return prev.map((message) => {
          if (message.id !== id) return message;
          return {
            ...message,
            text: `${message.text}${delta}`,
            status: "in_progress",
          };
        });
      }
      // Create a new assistant message if it doesn't exist
      return [
        ...prev,
        {
          id,
          role: "assistant" as MessageRole,
          text: delta,
          status: "in_progress" as const,
        },
      ];
    });
  }, []);

  const markMessageDone = useCallback((id: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, status: "done" } : m))
    );
  }, []);

  const resetConnection = useCallback(() => {
    cleanupRef.current();
    cleanupRef.current = () => {};
    dcRef.current = null;
    pcRef.current = null;
    setMessages([]);
    setIsMuted(false);
    setIsOutputAudioBufferActive(false);
    setConnectionState(CONNECTION_STATES.DISCONNECTED);
  }, []);

  const sendClientEvent = useCallback((payload: Record<string, unknown>) => {
    const channel = dcRef.current;
    if (!channel || channel.readyState !== "open") {
      throw new Error("Realtime connection is not ready");
    }
    channel.send(JSON.stringify(payload));
  }, []);

  const runTool = useCallback(async (call: FunctionCallPayload) => {
    const outbound = {
      name: call.name,
      arguments: call.arguments ?? {},
    };
    try {
      const payload = await callRealtimeTool(outbound);
      if (payload.result === undefined && !payload.error) {
        console.warn("Realtime tool returned empty result", payload);
      }
      return {
        payload: outbound,
        response:
          payload.error !== undefined ? { error: payload.error } : payload.result ?? {},
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Tool execution failed";
      return { payload: outbound, response: { error: message } };
    }
  }, []);

  const handleFunctionCall = useCallback(
    async (call: FunctionCallPayload) => {
      const parsedArgs =
        typeof call.arguments === "string"
          ? call.arguments
          : JSON.stringify(call.arguments ?? {});
      addOrUpdateMessage(
        call.call_id || call.name || crypto.randomUUID(),
        "tool",
        `Running ${call.name}...`,
        "in_progress"
      );

      const result = await runTool({
        ...call,
        arguments: safeJsonParse(parsedArgs),
      });
      const messageId = call.call_id || call.name || crypto.randomUUID();
      setMessages((prev) => {
        const existing = prev.find((m) => m.id === messageId);
        if (existing) {
          return prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  text: `${call.name} completed`,
                  status: "done" as const,
                  toolResult: result,
                }
              : m
          );
        }
        return [
          ...prev,
          {
            id: messageId,
            role: "tool" as MessageRole,
            text: `${call.name} completed`,
            status: "done" as const,
            toolResult: result,
          },
        ];
      });

      try {
        sendClientEvent({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(result ?? {}),
          },
        });
        sendClientEvent({ type: "response.create" });
      } catch (err) {
        setConnectionError(
          err instanceof Error
            ? err.message
            : "Unable to send tool output to model"
        );
      }
    },
    [addOrUpdateMessage, runTool, sendClientEvent]
  );

  const handleServerEvent = useCallback(
    (raw: ServerEvent) => {
      switch (raw.type) {
        case "session.created": {
          setConnectionState(CONNECTION_STATES.CONNECTED);
          return;
        }
        case "output_audio_buffer.started": {
          setIsOutputAudioBufferActive(true);
          return;
        }
        case "output_audio_buffer.stopped": {
          setIsOutputAudioBufferActive(false);
          return;
        }
        case "conversation.item.created": {
          const role =
            (raw.item?.role as MessageRole | undefined) ?? "assistant";
          const id = raw.item?.id || crypto.randomUUID();
          const text =
            raw.item?.content?.[0]?.text ||
            raw.item?.content?.[0]?.transcript ||
            "";
          addOrUpdateMessage(
            id,
            role,
            text || (role === "user" ? "[Listening...]" : "")
          );
          return;
        }
        case "conversation.item.input_audio_transcription.completed": {
          const id = raw.item_id;
          if (id) {
            const finalText =
              raw.transcript && raw.transcript !== "\n"
                ? raw.transcript
                : "[inaudible]";
            addOrUpdateMessage(id, "user", finalText, "done");
          }
          return;
        }
        case "response.audio_transcript.delta":
        case "response.output_text.delta": {
          const id =
            raw.item_id || raw.response?.output?.[0]?.id || crypto.randomUUID();
          const delta =
            raw.delta || raw.response?.output?.[0]?.content?.[0]?.text || "";
          if (delta) {
            appendAssistantText(id, delta);
          }
          return;
        }
        case "response.output_item.done": {
          const id = raw.item?.id;
          if (id) {
            markMessageDone(id);
          }
          return;
        }
        case "response.done": {
          const outputs = raw.response?.output ?? [];
          outputs.forEach((item) => {
            if (item.type === "function_call" && item.name) {
              void handleFunctionCall({
                name: item.name,
                call_id: item.call_id,
                arguments: item.arguments,
              });
            }
            if (item.type === "message" && item.role === "assistant") {
              const text =
                item.content?.[0]?.transcript || item.content?.[0]?.text || "";
              const id = item.id || crypto.randomUUID();
              addOrUpdateMessage(id, "assistant", text || "", "done");
            }
          });
          return;
        }
        default:
          return;
      }
    },
    [
      addOrUpdateMessage,
      appendAssistantText,
      handleFunctionCall,
      markMessageDone,
    ]
  );

  const handleTextSubmit = useCallback(
    (event?: React.FormEvent) => {
      event?.preventDefault();
      if (!inputText.trim()) return;
      try {
        sendClientEvent({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: inputText.trim() }],
          },
        });
        sendClientEvent({ type: "response.create" });
        setInputText("");
      } catch (err) {
        setConnectionError(
          err instanceof Error ? err.message : "Unable to send message"
        );
      }
    },
    [inputText, sendClientEvent]
  );

  const sendSessionUpdate = useCallback(() => {
    if (!dcRef.current || dcRef.current.readyState !== "open") return;

    const session: Record<string, unknown> = {
      modalities: ["text", "audio"],
      input_audio_transcription: { model: "gpt-4o-transcribe", language: "sk" },
      tools: realtimeTools,
    };

    if (resolvedPromptId) {
      session.prompt = { id: resolvedPromptId };
    }

    try {
      sendClientEvent({ type: "session.update", session });
    } catch (err) {
      setConnectionError(
        err instanceof Error ? err.message : "Unable to update session"
      );
    }
  }, [resolvedPromptId, sendClientEvent]);

  const handleConnect = useCallback(async () => {
    if (!resolvedPromptId) {
      setConnectionError("Prompt ID is not configured");
      return;
    }

    const attemptId = connectAttemptRef.current + 1;
    connectAttemptRef.current = attemptId;

    connectAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    connectAbortControllerRef.current = abortController;

    setConnectionError(null);
    setConnectionState(CONNECTION_STATES.CONNECTING);

    try {
      const ephemeral = await createRealtimeSession(
        resolvedPromptId,
        abortController.signal
      );
      if (
        abortController.signal.aborted ||
        attemptId !== connectAttemptRef.current
      ) {
        return;
      }
      const clientSecret = ephemeral.client_secret?.value;
      if (!clientSecret) {
        throw new Error("Missing client secret in response");
      }
      const apiBase = deriveApiBase(ephemeral.url) || DEFAULT_API_BASE;

      if (!audioRef.current) {
        audioRef.current = document.createElement("audio");
      }
      audioRef.current.autoplay = true;

      const { pc, dc } = await createRealtimeConnection({
        apiBase,
        clientSecret,
        audioElement: audioRef,
        abortSignal: abortController.signal,
      });
      if (
        abortController.signal.aborted ||
        attemptId !== connectAttemptRef.current
      ) {
        try {
          dc.close();
        } catch (err) {
          console.warn("Error closing data channel after abort", err);
        }
        pc.getSenders().forEach((sender) => sender.track?.stop());
        pc.close();
        return;
      }

      pcRef.current = pc;
      dcRef.current = dc;

      const stopTracks = () => {
        pc.getSenders().forEach((sender) => sender.track?.stop());
        pc.close();
      };

      const handleClose = () => {
        resetConnection();
      };

      const localCleanup = () => {
        dc.removeEventListener("close", handleClose);
        try {
          dc.close();
        } catch (err) {
          console.warn("Error closing data channel", err);
        }
        stopTracks();
      };

      if (
        abortController.signal.aborted ||
        attemptId !== connectAttemptRef.current
      ) {
        localCleanup();
        return;
      }

      dc.addEventListener("open", () => {
        sendSessionUpdate();
      });
      dc.addEventListener("message", (event: MessageEvent<string>) => {
        const parsed = parseServerEventData(event.data);
        if (parsed) {
          handleServerEvent(parsed);
        }
      });
      dc.addEventListener("close", handleClose);
      dc.addEventListener("error", (err) => {
        console.error("Data channel error", err);
        setConnectionError("Realtime connection encountered an error");
        handleClose();
      });

      pc.addEventListener("connectionstatechange", () => {
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed" ||
          pc.connectionState === "disconnected"
        ) {
          handleClose();
        }
      });

      cleanupRef.current = localCleanup;
    } catch (err) {
      if (
        abortController.signal.aborted ||
        attemptId !== connectAttemptRef.current
      ) {
        return;
      }
      console.error(err);
      setConnectionError(
        err instanceof Error ? err.message : "Unable to create Realtime session"
      );
      resetConnection();
    } finally {
      if (connectAbortControllerRef.current === abortController) {
        connectAbortControllerRef.current = null;
      }
    }
  }, [handleServerEvent, resetConnection, resolvedPromptId, sendSessionUpdate]);

  const handleDisconnect = useCallback(() => {
    connectAbortControllerRef.current?.abort();
    connectAbortControllerRef.current = null;
    connectAttemptRef.current += 1;
    cleanupRef.current();
    resetConnection();
  }, [resetConnection]);

  const handleToggleMute = useCallback(() => {
    if (connectionState !== CONNECTION_STATES.CONNECTED) return;
    const pc = pcRef.current;
    if (!pc) return;

    const newMutedState = !isMuted;
    pc.getSenders().forEach((sender) => {
      if (sender.track && sender.track.kind === "audio") {
        sender.track.enabled = !newMutedState;
      }
    });
    setIsMuted(newMutedState);
  }, [connectionState, isMuted]);

  useEffect(() => {
    return () => {
      cleanupRef.current();
    };
  }, []);

  useEffect(() => {
    if (connectionState === CONNECTION_STATES.CONNECTED) {
      sendSessionUpdate();
    }
  }, [connectionState, resolvedPromptId, sendSessionUpdate]);

  useEffect(() => {
    if (hasAutoConnectedRef.current) return;
    if (connectionState !== CONNECTION_STATES.DISCONNECTED) return;
    if (!resolvedPromptId) return;
    if (!shouldAutoConnect) return;

    hasAutoConnectedRef.current = true;
    void handleConnect();
  }, [connectionState, handleConnect, resolvedPromptId, shouldAutoConnect]);

  // Expose connection handlers to parent
  useEffect(() => {
    onConnectionHandlersReady?.({
      connect: handleConnect,
      disconnect: handleDisconnect,
    });
  }, [handleConnect, handleDisconnect, onConnectionHandlersReady]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div
      className={`relative flex h-full min-h-0 w-full flex-col bg-white ${
        className ?? ""
      }`}
    >
      {/* Connection error banner */}
      {connectionError && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {connectionError}
        </div>
      )}

      {/* Scrollable messages area */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 pb-28">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center py-20">
              <p className="text-sm text-slate-400">
                Start speaking or type a message to begin.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages
                .filter(
                  (message) => message.role !== "assistant" || message.text
                )
                .map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${
                      message.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`rounded-2xl px-4 py-3 ${
                        message.role === "user"
                          ? "bg-rose-100 text-slate-900 max-w-[85%]"
                          : message.role === "tool"
                          ? "bg-amber-50 border border-amber-200 text-amber-900"
                          : "bg-transparent text-slate-900"
                      }`}
                    >
                      {message.role !== "user" && (
                        <div className="mb-1 flex items-center gap-2">
                          <span className="text-xs font-medium text-slate-500">
                            {message.role === "assistant" ? "Luna" : "Tool"}
                          </span>
                          {message.status === "in_progress" && (
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          )}
                        </div>
                      )}
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">
                        {message.text || "…"}
                      </p>
                      {message.role === "tool" &&
                        message.toolResult !== undefined && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs text-amber-700 hover:text-amber-900">
                              Response
                            </summary>
                            <div className="mt-1 space-y-2">
                              {"payload" in (message.toolResult as any) && (
                                <pre className="max-h-48 overflow-auto rounded bg-amber-100/50 p-2 text-xs text-amber-800">
                                  {JSON.stringify(
                                    (message.toolResult as any)?.payload,
                                    null,
                                    2
                                  )}
                                </pre>
                              )}
                              <pre className="max-h-48 overflow-auto rounded bg-amber-100/50 p-2 text-xs text-amber-800">
                                {JSON.stringify(
                                  (message.toolResult as any)?.response ??
                                    message.toolResult,
                                  null,
                                  2
                                )}
                              </pre>
                            </div>
                          </details>
                        )}
                    </div>
                  </div>
                ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Bottom input area - sticky footer */}
      <div className="sticky bottom-0 border-t border-slate-200 bg-white px-4 pt-4 pb-[max(12px,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-3xl">
          <form
            className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-2 py-2"
            onSubmit={handleTextSubmit}
          >
            {/* Plus button placeholder */}
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition"
              disabled
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-5 w-5"
              >
                <path
                  fillRule="evenodd"
                  d="M12 3.75a.75.75 0 0 1 .75.75v6.75h6.75a.75.75 0 0 1 0 1.5h-6.75v6.75a.75.75 0 0 1-1.5 0v-6.75H4.5a.75.75 0 0 1 0-1.5h6.75V4.5a.75.75 0 0 1 .75-.75Z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Ask anything"
              className="flex-1 bg-transparent py-2 text-sm text-slate-900 placeholder-slate-400 outline-none disabled:opacity-60"
              disabled={connectionState !== CONNECTION_STATES.CONNECTED}
            />

            {/* Mute button */}
            <button
              type="button"
              onClick={handleToggleMute}
              disabled={connectionState !== CONNECTION_STATES.CONNECTED}
              className={`flex h-8 w-8 items-center justify-center rounded-full transition ${
                isMuted
                  ? "bg-red-500 text-white"
                  : "text-slate-400 hover:bg-slate-200 hover:text-slate-600 disabled:opacity-50"
              }`}
              title={isMuted ? "Unmute microphone" : "Mute microphone"}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-5 w-5"
              >
                <path d="M8.25 4.5a3.75 3.75 0 1 1 7.5 0v8.25a3.75 3.75 0 1 1-7.5 0V4.5Z" />
                <path d="M6 10.5a.75.75 0 0 1 .75.75v1.5a5.25 5.25 0 1 0 10.5 0v-1.5a.75.75 0 0 1 1.5 0v1.5a6.751 6.751 0 0 1-6 6.709v2.291h3a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1 0-1.5h3v-2.291a6.751 6.751 0 0 1-6-6.709v-1.5A.75.75 0 0 1 6 10.5Z" />
              </svg>
            </button>

            {/* Send / Stop button */}
            <button
              type="submit"
              disabled={
                connectionState !== CONNECTION_STATES.CONNECTED ||
                !inputText.trim()
              }
              className={`flex h-8 w-8 items-center justify-center rounded-full transition ${
                connectionState === CONNECTION_STATES.CONNECTED &&
                inputText.trim()
                  ? "bg-slate-900 text-white hover:bg-slate-700"
                  : "bg-slate-200 text-slate-400"
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-4 w-4"
              >
                <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
              </svg>
            </button>
          </form>
          <p className="mt-2 text-center text-xs text-slate-400">
            Luna can make mistakes. Check important info.
          </p>
        </div>
      </div>
    </div>
  );
}

function parseServerEventData(raw: string): ServerEvent | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "type" in parsed) {
      return parsed as ServerEvent;
    }
  } catch (err) {
    console.warn("Unable to parse server event", err);
  }
  return null;
}

function safeJsonParse(
  value: string | Record<string, unknown>
): Record<string, unknown> {
  if (typeof value !== "string") {
    return value && typeof value === "object" ? value : {};
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
