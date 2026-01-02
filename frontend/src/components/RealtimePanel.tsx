import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRealtimeConnection } from "../lib/realtimeConnection";
import { createRealtimeSession } from "../lib/api";
import { realtimeTools } from "../lib/realtimeTools";

const DEFAULT_MODEL =
  (import.meta.env.VITE_REALTIME_MODEL as string | undefined) || "gpt-4o-realtime-preview-2025-06-03";
const DEFAULT_VOICE = (import.meta.env.VITE_REALTIME_VOICE as string | undefined) || "alloy";
const DEFAULT_API_BASE = (import.meta.env.VITE_REALTIME_API_BASE as string | undefined) || "https://api.openai.com";

const CONNECTION_STATES = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
} as const;

type ConnectionState = (typeof CONNECTION_STATES)[keyof typeof CONNECTION_STATES];

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
  model?: string;
  voice?: string;
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

export function RealtimePanel({ className, promptId, model, voice }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const cleanupRef = useRef<() => void>(() => {});

  const [connectionState, setConnectionState] = useState<ConnectionState>(CONNECTION_STATES.DISCONNECTED);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isOutputAudioBufferActive, setIsOutputAudioBufferActive] = useState(false);
  const [isPushToTalk, setIsPushToTalk] = useState(false);
  const [isTalking, setIsTalking] = useState(false);
  const [inputText, setInputText] = useState("");
  const [sessionDetails, setSessionDetails] = useState<{ model: string; voice: string; prompt?: string; apiBase: string } | null>(null);

  const resolvedModel = model || sessionDetails?.model || DEFAULT_MODEL;
  const resolvedVoice = voice || sessionDetails?.voice || DEFAULT_VOICE;
  const resolvedPromptId = promptId || sessionDetails?.prompt;

  const addOrUpdateMessage = useCallback((id: string, role: MessageRole, text: string, status: "in_progress" | "done" = "in_progress") => {
    setMessages((prev) => {
      const existing = prev.find((m) => m.id === id);
      if (existing) {
        return prev.map((m) => (m.id === id ? { ...m, role, text, status } : m));
      }
      return [...prev, { id, role, text, status }];
    });
  }, []);

  const appendAssistantText = useCallback((id: string, delta: string) => {
    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== id) return message;
        return { ...message, text: `${message.text}${delta}`, status: "in_progress" };
      })
    );
  }, []);

  const markMessageDone = useCallback((id: string) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, status: "done" } : m)));
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

  const sendClientEvent = useCallback(
    (payload: Record<string, unknown>) => {
      const channel = dcRef.current;
      if (!channel || channel.readyState !== "open") {
        throw new Error("Realtime connection is not ready");
      }
      channel.send(JSON.stringify(payload));
    },
    []
  );

  const runTool = useCallback(async (call: FunctionCallPayload) => {
    try {
      const response = await fetch("/api/realtime/tool", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: call.name, arguments: call.arguments ?? {} }),
      });
      const payload = (await response.json().catch(() => ({}))) as { result?: unknown; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Tool execution failed");
      }
      return payload.result ?? {};
    } catch (err) {
      const message = err instanceof Error ? err.message : "Tool execution failed";
      return { error: message };
    }
  }, []);

  const handleFunctionCall = useCallback(
    async (call: FunctionCallPayload) => {
      const parsedArgs = typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? {});
      addOrUpdateMessage(call.call_id || call.name || crypto.randomUUID(), "tool", `Running ${call.name}...`, "in_progress");

      const result = await runTool({ ...call, arguments: safeJsonParse(parsedArgs) });
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
        setConnectionError(err instanceof Error ? err.message : "Unable to send tool output to model");
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
          const role = (raw.item?.role as MessageRole | undefined) ?? "assistant";
          const id = raw.item?.id || crypto.randomUUID();
          const text = raw.item?.content?.[0]?.text || raw.item?.content?.[0]?.transcript || "";
          addOrUpdateMessage(id, role, text || (role === "user" ? "[Listening...]" : ""));
          return;
        }
        case "conversation.item.input_audio_transcription.completed": {
          const id = raw.item_id;
          if (id) {
            const finalText = raw.transcript && raw.transcript !== "\n" ? raw.transcript : "[inaudible]";
            addOrUpdateMessage(id, "user", finalText, "done");
          }
          return;
        }
        case "response.audio_transcript.delta":
        case "response.output_text.delta": {
          const id = raw.item_id || raw.response?.output?.[0]?.id || crypto.randomUUID();
          const delta = raw.delta || raw.response?.output?.[0]?.content?.[0]?.text || "";
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
              void handleFunctionCall({ name: item.name, call_id: item.call_id, arguments: item.arguments });
            }
            if (item.type === "message" && item.role === "assistant") {
              const text = item.content?.[0]?.transcript || item.content?.[0]?.text || "";
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
    [addOrUpdateMessage, appendAssistantText, handleFunctionCall, markMessageDone]
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
        setConnectionError(err instanceof Error ? err.message : "Unable to send message");
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
      voice: resolvedVoice,
      input_audio_transcription: { model: "whisper-1" },
      turn_detection: turnDetection,
      tools: realtimeTools,
    };

    if (resolvedPromptId) {
      session.prompt = { id: resolvedPromptId };
    }

    try {
      sendClientEvent({ type: "session.update", session });
    } catch (err) {
      setConnectionError(err instanceof Error ? err.message : "Unable to update session");
    }
  }, [isPushToTalk, resolvedPromptId, resolvedVoice, sendClientEvent]);

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
      const selectedModel = ephemeral.model || resolvedModel;
      const selectedVoice = ephemeral.voice || resolvedVoice;

      if (!audioRef.current) {
        audioRef.current = document.createElement("audio");
      }
      audioRef.current.autoplay = true;

      const { pc, dc } = await createRealtimeConnection({
        apiBase,
        model: selectedModel,
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
        setSessionDetails({ model: selectedModel, voice: selectedVoice, prompt: resolvedPromptId, apiBase });
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
        if (pc.connectionState === "failed" || pc.connectionState === "closed" || pc.connectionState === "disconnected") {
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
      setConnectionError(err instanceof Error ? err.message : "Unable to create Realtime session");
      resetConnection();
    }
  }, [handleServerEvent, resetConnection, resolvedModel, resolvedPromptId, resolvedVoice, sendSessionUpdate]);

  const handleDisconnect = useCallback(() => {
    cleanupRef.current();
    resetConnection();
  }, [resetConnection]);

  const handleTalkDown = useCallback(() => {
    if (connectionState !== CONNECTION_STATES.CONNECTED || !isPushToTalk) return;
    setIsTalking(true);
    try {
      sendClientEvent({ type: "input_audio_buffer.clear" });
    } catch (err) {
      setConnectionError(err instanceof Error ? err.message : "Unable to start recording");
    }
  }, [connectionState, isPushToTalk, sendClientEvent]);

  const handleTalkUp = useCallback(() => {
    if (connectionState !== CONNECTION_STATES.CONNECTED || !isPushToTalk || !isTalking) return;
    setIsTalking(false);
    try {
      sendClientEvent({ type: "input_audio_buffer.commit" });
      sendClientEvent({ type: "response.create" });
    } catch (err) {
      setConnectionError(err instanceof Error ? err.message : "Unable to send audio");
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
    <div className={`w-full flex flex-col gap-4 px-4 py-6 ${className ?? ""}`}>
      <div className="flex flex-col gap-2 rounded-xl bg-white p-4 shadow-sm border border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs uppercase font-semibold text-slate-500">Realtime voice assistant</p>
            <p className="text-lg font-semibold text-slate-900">Status: {headerStatus}</p>
            <p className="text-sm text-slate-600">
              Prompt ID: <span className="font-mono text-slate-800">{resolvedPromptId || "Not configured"}</span>
            </p>
            <p className="text-sm text-slate-600">
              Model: <span className="font-semibold text-slate-800">{resolvedModel}</span> · Voice: {resolvedVoice}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={connectionState === CONNECTION_STATES.DISCONNECTED ? handleConnect : handleDisconnect}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
                connectionState === CONNECTION_STATES.DISCONNECTED ? "bg-emerald-600 hover:bg-emerald-500" : "bg-slate-600 hover:bg-slate-500"
              }`}
            >
              {connectionState === CONNECTION_STATES.DISCONNECTED ? "Connect" : "Disconnect"}
            </button>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={isPushToTalk}
                onChange={() => setIsPushToTalk((prev) => !prev)}
              />
              Push-to-talk
            </label>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                isOutputAudioBufferActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"
              }`}
            >
              {isOutputAudioBufferActive ? "Assistant speaking" : "Idle"}
            </span>
          </div>
        </div>
        {connectionError ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {connectionError}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 h-full min-h-[420px]">
        <div className="flex flex-col rounded-xl bg-white shadow-sm border border-slate-200 overflow-hidden min-h-[360px]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div className="text-sm font-semibold text-slate-800">Transcript</div>
            {isPushToTalk && connectionState === CONNECTION_STATES.CONNECTED ? (
              <button
                onMouseDown={handleTalkDown}
                onMouseUp={handleTalkUp}
                onMouseLeave={handleTalkUp}
                onTouchStart={handleTalkDown}
                onTouchEnd={handleTalkUp}
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  isTalking ? "bg-rose-600 text-white" : "bg-emerald-600 text-white"
                }`}
              >
                {isTalking ? "Release to send" : "Hold to talk"}
              </button>
            ) : null}
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 ? (
              <p className="text-sm text-slate-500">Start speaking or type a message to begin.</p>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex flex-col gap-1 rounded-lg border px-3 py-2 ${
                    message.role === "user"
                      ? "border-blue-100 bg-blue-50"
                      : message.role === "tool"
                      ? "border-amber-100 bg-amber-50"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-500">
                    <span>{message.role === "assistant" ? "Assistant" : message.role === "user" ? "You" : "Tool"}</span>
                    <span className="text-[11px] font-semibold text-slate-400">{message.status === "done" ? "Done" : "Live"}</span>
                  </div>
                  <p className="text-sm text-slate-800 whitespace-pre-line">{message.text || "…"}</p>
                </div>
              ))
            )}
          </div>
          <form className="border-t border-slate-200 p-3 flex items-center gap-2" onSubmit={handleTextSubmit}>
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Type a message to send to the same stream"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              disabled={connectionState !== CONNECTION_STATES.CONNECTED}
            />
            <button
              type="submit"
              disabled={connectionState !== CONNECTION_STATES.CONNECTED || !inputText.trim()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              Send
            </button>
          </form>
        </div>

        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-800">Connection</p>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  connectionState === CONNECTION_STATES.CONNECTED
                    ? "bg-emerald-100 text-emerald-800"
                    : connectionState === CONNECTION_STATES.CONNECTING
                    ? "bg-amber-100 text-amber-800"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {headerStatus}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-slate-700">
              <dt>Prompt</dt>
              <dd className="font-mono text-[13px] text-slate-900 truncate">{resolvedPromptId || "None"}</dd>
              <dt>Model</dt>
              <dd className="text-slate-900">{resolvedModel}</dd>
              <dt>Voice</dt>
              <dd className="text-slate-900">{resolvedVoice}</dd>
              <dt>API base</dt>
              <dd className="text-slate-900">{sessionDetails?.apiBase || deriveApiBase(undefined)}</dd>
              <dt>Audio mode</dt>
              <dd className="text-slate-900">{isPushToTalk ? "Push-to-talk" : "Voice activity"}</dd>
            </dl>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-2 text-sm text-slate-700">
            <p className="text-sm font-semibold text-slate-800">Tips</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Hold the mic button in push-to-talk mode to stream audio into the same session as text.</li>
              <li>Tool calls are executed server-side with Google alias protections; outputs stream back to the model.</li>
              <li>Keep the prompt ID updated to control behavior without hardcoded instructions.</li>
            </ul>
          </div>
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

function safeJsonParse(value: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof value !== "string") {
    return value && typeof value === "object" ? value : {};
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
