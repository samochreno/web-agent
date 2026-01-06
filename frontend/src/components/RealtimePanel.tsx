import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRealtimeConnection } from "../lib/realtimeConnection";
import { createRealtimeSession } from "../lib/api";
import { realtimeTools } from "../lib/realtimeTools";

const DEFAULT_API_BASE =
  (import.meta.env.VITE_REALTIME_API_BASE as string | undefined) ||
  "https://api.openai.com";

const CONNECTION_STATES = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
} as const;

type ConnectionState =
  (typeof CONNECTION_STATES)[keyof typeof CONNECTION_STATES];

type MessageRole = "user" | "assistant" | "tool";

type ConversationMessage = {
  id: string;
  role: MessageRole;
  text: string;
  status: "in_progress" | "done";
};

type Props = {
  className?: string;
  promptId?: string;
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

export function RealtimePanel({ className, promptId }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const cleanupRef = useRef<() => void>(() => {});

  const [connectionState, setConnectionState] = useState<ConnectionState>(
    CONNECTION_STATES.DISCONNECTED
  );
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isOutputAudioBufferActive, setIsOutputAudioBufferActive] =
    useState(false);
  const [isPushToTalk, setIsPushToTalk] = useState(false);
  const [isTalking, setIsTalking] = useState(false);
  const [inputText, setInputText] = useState("");
  const [sessionDetails, setSessionDetails] = useState<{
    prompt?: string;
    apiBase: string;
  } | null>(null);

  const resolvedPromptId = promptId || sessionDetails?.prompt;

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
    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== id) return message;
        return {
          ...message,
          text: `${message.text}${delta}`,
          status: "in_progress",
        };
      })
    );
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
    setIsTalking(false);
    setIsOutputAudioBufferActive(false);
    setSessionDetails(null);
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
    try {
      const response = await fetch("/api/realtime/tool", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: call.name,
          arguments: call.arguments ?? {},
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        result?: unknown;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Tool execution failed");
      }
      return payload.result ?? {};
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Tool execution failed";
      return { error: message };
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
      addOrUpdateMessage(
        call.call_id || call.name || crypto.randomUUID(),
        "tool",
        `${call.name} completed`,
        "done"
      );

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

    const turnDetection = isPushToTalk
      ? null
      : {
          type: "server_vad",
          threshold: 0.8,
          prefix_padding_ms: 300,
          silence_duration_ms: 600,
          create_response: true,
        };

    const session: Record<string, unknown> = {
      modalities: ["text", "audio"],
      // input_audio_transcription: { model: "whisper-1" },
      turn_detection: turnDetection,
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
  }, [isPushToTalk, resolvedPromptId, sendClientEvent]);

  const handleConnect = useCallback(async () => {
    if (!resolvedPromptId) {
      setConnectionError("Prompt ID is not configured");
      return;
    }
    setConnectionError(null);
    setConnectionState(CONNECTION_STATES.CONNECTING);

    try {
      const ephemeral = await createRealtimeSession(resolvedPromptId);
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
      });

      pcRef.current = pc;
      dcRef.current = dc;

      const stopTracks = () => {
        pc.getSenders().forEach((sender) => sender.track?.stop());
        pc.close();
      };

      const handleClose = () => {
        resetConnection();
      };

      dc.addEventListener("open", () => {
        setSessionDetails({ prompt: resolvedPromptId, apiBase });
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

      cleanupRef.current = () => {
        dc.removeEventListener("close", handleClose);
        try {
          dc.close();
        } catch (err) {
          console.warn("Error closing data channel", err);
        }
        stopTracks();
      };
    } catch (err) {
      console.error(err);
      setConnectionError(
        err instanceof Error ? err.message : "Unable to create Realtime session"
      );
      resetConnection();
    }
  }, [handleServerEvent, resetConnection, resolvedPromptId, sendSessionUpdate]);

  const handleDisconnect = useCallback(() => {
    cleanupRef.current();
    resetConnection();
  }, [resetConnection]);

  const handleTalkDown = useCallback(() => {
    if (connectionState !== CONNECTION_STATES.CONNECTED || !isPushToTalk)
      return;
    setIsTalking(true);
    try {
      sendClientEvent({ type: "input_audio_buffer.clear" });
    } catch (err) {
      setConnectionError(
        err instanceof Error ? err.message : "Unable to start recording"
      );
    }
  }, [connectionState, isPushToTalk, sendClientEvent]);

  const handleTalkUp = useCallback(() => {
    if (
      connectionState !== CONNECTION_STATES.CONNECTED ||
      !isPushToTalk ||
      !isTalking
    )
      return;
    setIsTalking(false);
    try {
      sendClientEvent({ type: "input_audio_buffer.commit" });
      sendClientEvent({ type: "response.create" });
    } catch (err) {
      setConnectionError(
        err instanceof Error ? err.message : "Unable to send audio"
      );
    }
  }, [connectionState, isPushToTalk, isTalking, sendClientEvent]);

  useEffect(() => {
    return () => {
      cleanupRef.current();
    };
  }, []);

  useEffect(() => {
    if (connectionState === CONNECTION_STATES.CONNECTED) {
      sendSessionUpdate();
    }
  }, [connectionState, isPushToTalk, resolvedPromptId, sendSessionUpdate]);

  const headerStatus = useMemo(() => {
    if (connectionState === CONNECTION_STATES.CONNECTED) return "Live";
    if (connectionState === CONNECTION_STATES.CONNECTING) return "Connecting";
    return "Disconnected";
  }, [connectionState]);


  return (
    <div
      className={`relative h-full w-full overflow-hidden rounded-[28px] border border-slate-200/70 bg-gradient-to-b from-slate-50 via-white to-slate-100 px-5 py-6 shadow-xl ${
        className ?? ""
      }`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(14,165,233,0.08),transparent_32%),radial-gradient(circle_at_80%_0%,rgba(99,102,241,0.06),transparent_32%),radial-gradient(circle_at_50%_80%,rgba(52,211,153,0.05),transparent_30%)]" />

      <div className="relative flex flex-col gap-4 h-full">
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.16em] font-semibold text-slate-500">
                Cortana
              </p>
              <div className="flex items-center gap-2">
                <p className="text-xl font-semibold text-slate-900">Status</p>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold shadow-sm ${statusBadgeClass}`}
                >
                  {headerStatus}
                </span>
              </div>
            </div>

            <div className="flex w-full flex-wrap items-center justify-end gap-3 max-md:justify-start">
              <span
                className={`flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[12px] font-semibold text-slate-700 shadow-sm ${
                  isOutputAudioBufferActive
                    ? "border-emerald-200 text-emerald-700"
                    : ""
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    isOutputAudioBufferActive
                      ? "bg-emerald-500 shadow-[0_0_0_6px_rgba(16,185,129,0.2)]"
                      : "bg-slate-400"
                  }`}
                />
                {isOutputAudioBufferActive ? "Assistant speaking" : "Idle"}
              </span>

              <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[12px] font-semibold text-slate-700 shadow-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-emerald-500"
                  checked={isPushToTalk}
                  onChange={() => setIsPushToTalk((prev) => !prev)}
                />
                Push-to-talk
              </label>

              <button
                onClick={
                  connectionState === CONNECTION_STATES.DISCONNECTED
                    ? handleConnect
                    : handleDisconnect
                }
                className={`rounded-full px-4 py-2 text-sm font-semibold shadow-sm transition ${
                  connectionState === CONNECTION_STATES.DISCONNECTED
                    ? "bg-emerald-500 text-white hover:bg-emerald-400"
                    : "bg-slate-900 text-white hover:bg-slate-800"
                }`}
              >
                {connectionState === CONNECTION_STATES.DISCONNECTED
                  ? "Connect"
                  : "Disconnect"}
              </button>
            </div>
          </div>

          {connectionError ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 shadow-inner">
              {connectionError}
            </div>
          ) : null}
        </div>

        <div className="flex min-h-[420px] flex-col gap-3 rounded-2xl border border-slate-200 bg-white/90 shadow-sm backdrop-blur h-full">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Transcript
            </div>
            {isPushToTalk && connectionState === CONNECTION_STATES.CONNECTED ? (
              <button
                onMouseDown={handleTalkDown}
                onMouseUp={handleTalkUp}
                onMouseLeave={handleTalkUp}
                onTouchStart={handleTalkDown}
                onTouchEnd={handleTalkUp}
                className={`rounded-full px-4 py-2 text-sm font-semibold shadow-sm transition ${
                  isTalking
                    ? "bg-rose-500 text-white hover:bg-rose-400"
                    : "bg-emerald-500 text-white hover:bg-emerald-400"
                }`}
              >
                {isTalking ? "Release to send" : "Hold to talk"}
              </button>
            ) : null}
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
            {messages.length === 0 ? (
              <p className="text-sm text-slate-500">
                Start speaking or type a message to begin.
              </p>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex flex-col gap-1 max-w-3xl rounded-2xl border px-4 py-3 shadow-sm transition ${
                    message.role === "user"
                      ? "self-end border-sky-200 bg-sky-50 text-sky-900"
                      : message.role === "tool"
                      ? "self-start border-amber-200 bg-amber-50 text-amber-900"
                      : "self-start border-slate-200 bg-slate-50 text-slate-900"
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-slate-500">
                    <span>
                      {message.role === "assistant"
                        ? "Assistant"
                        : message.role === "user"
                        ? "You"
                        : "Tool"}
                    </span>
                    <span className="text-[11px] font-semibold text-slate-400">
                      {message.status === "done" ? "Done" : "Live"}
                    </span>
                  </div>
                  <p className="text-sm leading-6 text-slate-900 whitespace-pre-line">
                    {message.text || "…"}
                  </p>
                </div>
              ))
            )}
          </div>

          <form
            className="flex items-center gap-3 border-t border-slate-100 bg-slate-50/80 px-5 py-4"
            onSubmit={handleTextSubmit}
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Ask anything"
              className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-inner outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60"
              disabled={connectionState !== CONNECTION_STATES.CONNECTED}
            />
            <button
              type="submit"
              disabled={
                connectionState !== CONNECTION_STATES.CONNECTED ||
                !inputText.trim()
              }
              className="rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-emerald-400 disabled:opacity-60"
            >
              &rarr;
            </button>
          </form>
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
