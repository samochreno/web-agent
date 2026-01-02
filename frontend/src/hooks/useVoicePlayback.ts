import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { OpenAIChatKit } from "@openai/chatkit";

type Options = {
  enabled: boolean;
  chatkitRef: RefObject<OpenAIChatKit | null>;
  voice?: string;
  format?: string;
};

type Cleanup = () => void;

function extractAssistantText(detail: unknown): string | null {
  if (!detail || typeof detail !== "object") return null;
  const fromPath = (path: Array<string | number>): string | null => {
    let current: unknown = detail;
    for (const key of path) {
      if (Array.isArray(current) && typeof key === "number") {
        current = current[key];
        continue;
      }
      if (current && typeof current === "object" && typeof key === "string" && key in current) {
        current = (current as Record<string, unknown>)[key];
        continue;
      }
      return null;
    }
    return typeof current === "string" ? current : null;
  };

  const candidates = [
    fromPath(["item", "content", 0, "text", "value"]),
    fromPath(["message", "content", 0, "text", "value"]),
    fromPath(["content", 0, "text", "value"]),
    fromPath(["text"]),
    fromPath(["message", "text"]),
  ];

  for (const candidate of candidates) {
    if (candidate && candidate.trim()) return candidate.trim();
  }

  return null;
}

function extractAssistantId(detail: unknown): string | null {
  if (!detail || typeof detail !== "object") return null;
  const candidates: unknown[] = [
    (detail as { id?: unknown }).id,
    (detail as { item?: { id?: unknown } }).item?.id,
    (detail as { message?: { id?: unknown } }).message?.id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

async function playStreamingAudio(response: Response): Promise<Cleanup> {
  const mimeType = response.headers.get("content-type")?.split(";")[0] ?? "audio/mpeg";
  const supportsMediaSource =
    typeof MediaSource !== "undefined" && typeof window !== "undefined"
      ? MediaSource.isTypeSupported(mimeType)
      : false;

  if (!response.body || !supportsMediaSource) {
    const buffer = await response.arrayBuffer();
    const blobUrl = URL.createObjectURL(new Blob([buffer], { type: mimeType }));
    const audio = new Audio(blobUrl);
    await audio.play().catch(() => undefined);
    return () => {
      audio.pause();
      URL.revokeObjectURL(blobUrl);
    };
  }

  const mediaSource = new MediaSource();
  const objectUrl = URL.createObjectURL(mediaSource);
  let activeUrl = objectUrl;
  const audio = new Audio(objectUrl);
  audio.autoplay = true;
  void audio.play().catch(() => undefined);

  const reader = response.body.getReader();
  const queue: Uint8Array[] = [];
  let sourceBuffer: SourceBuffer | null = null;
  let done = false;

  const cleanup = () => {
    try {
      audio.pause();
    } catch (err) {
      console.error("Error stopping audio", err);
    }
    URL.revokeObjectURL(activeUrl);
    if (mediaSource.readyState === "open") {
      try {
        mediaSource.endOfStream();
      } catch (err) {
        console.error("Error ending media source", err);
      }
    }
  };

  mediaSource.addEventListener("sourceopen", () => {
    try {
      sourceBuffer = mediaSource.addSourceBuffer(mimeType);
    } catch (err) {
      console.error("Unable to create source buffer, falling back to blob", err);
      (async () => {
        try {
          const chunks: Uint8Array[] = [];
          while (true) {
            const { value, done: readerDone } = await reader.read();
            if (readerDone) break;
            if (value) chunks.push(value);
          }
          const blobUrl = URL.createObjectURL(new Blob(chunks, { type: mimeType }));
          activeUrl = blobUrl;
          audio.src = blobUrl;
          await audio.play().catch(() => undefined);
        } catch (readerErr) {
          console.error("Failed to fallback to blob playback", readerErr);
        }
      })().catch((err2) => console.error("Blob playback fallback failed", err2));
      return;
    }

    const flushQueue = () => {
      if (!sourceBuffer || sourceBuffer.updating || queue.length === 0) return;
      const chunk = queue.shift();
      if (chunk) {
        try {
          sourceBuffer.appendBuffer(chunk);
        } catch (err) {
          console.error("Error appending audio chunk", err);
        }
      }
    };

    sourceBuffer.addEventListener("updateend", () => {
      if (done && queue.length === 0 && mediaSource.readyState === "open") {
        try {
          mediaSource.endOfStream();
        } catch (err) {
          console.error("Error ending media source after update", err);
        }
      } else {
        flushQueue();
      }
    });

    (async () => {
      try {
        while (true) {
          const { value, done: readerDone } = await reader.read();
          if (readerDone) {
            done = true;
            if (
              sourceBuffer &&
              !sourceBuffer.updating &&
              queue.length === 0 &&
              mediaSource.readyState === "open"
            ) {
              try {
                mediaSource.endOfStream();
              } catch (err) {
                console.error("Error finalizing media source", err);
              }
            }
            break;
          }
          if (value && value.length > 0) {
            if (sourceBuffer && !sourceBuffer.updating && queue.length === 0) {
              sourceBuffer.appendBuffer(value);
            } else {
              queue.push(value);
            }
          }
        }
      } catch (err) {
        console.error("Error reading audio stream", err);
      }
    })().catch((err) => console.error("Audio stream reader failed", err));
  });

  return cleanup;
}

export function useVoicePlayback({
  enabled,
  chatkitRef,
  voice = "alloy",
  format = "mp3",
}: Options) {
  const cleanupRef = useRef<Cleanup | null>(null);
  const attachedElement = useRef<OpenAIChatKit | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const lastSpokenIdRef = useRef<string | null>(null);
  const spokeThisResponse = useRef(false);

  const stop = useCallback(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
  }, []);

  const speakText = useCallback(
    async (text: string | null) => {
      if (!enabled || !text || !text.trim()) return;
      stop();
      try {
        const response = await fetch("/api/speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice, format }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "Failed to synthesize speech");
        }
        const cleanup = await playStreamingAudio(response);
        cleanupRef.current = cleanup;
      } catch (err) {
        console.error("Voice playback failed", err);
      }
    },
    [enabled, format, stop, voice]
  );

  const fetchLatestAssistant = useCallback(async () => {
    if (!threadId) return;
    try {
      const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/latest-assistant`, {
        method: "GET",
        credentials: "include",
      });
      const payload = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
      if (response.status === 404) {
        return;
      }
      if (!response.ok) {
        const message = payload.error ?? response.statusText;
        if (message) console.warn("Failed to load latest assistant message:", message);
        return;
      }
      await speakText(payload.text ?? null);
    } catch (err) {
      console.error("Unable to fetch latest assistant message", err);
    }
  }, [speakText, threadId]);

  useEffect(() => {
    if (!enabled) {
      stop();
    }
  }, [enabled, stop]);

  const handleAssistantDetail = useCallback(
    (detail: unknown) => {
      const text = extractAssistantText(detail);
      if (!text) return;
      const id = extractAssistantId(detail);
      if (id && lastSpokenIdRef.current === id) return;
      if (id) lastSpokenIdRef.current = id;
      spokeThisResponse.current = true;
      void speakText(text);
    },
    [speakText]
  );

  useEffect(() => {
    let detach: (() => void) | null = null;
    let cancelled = false;

    const attachIfNeeded = () => {
      const element = chatkitRef.current;
      if (!element || element === attachedElement.current) return;
      attachedElement.current = element;

      const onThreadChange = (event: Event) => {
        const detail = (event as CustomEvent<{ threadId: string | null }>).detail;
        setThreadId(detail?.threadId ?? null);
      };
      const onResponseStart = () => {
        stop();
        spokeThisResponse.current = false;
      };
      const onResponseEnd = () => {
        if (!spokeThisResponse.current) {
          void fetchLatestAssistant();
        }
      };
      const onAssistantMessage = (event: Event) =>
        handleAssistantDetail((event as CustomEvent<unknown>).detail);

      element.addEventListener("chatkit.thread.change", onThreadChange as EventListener);
      element.addEventListener("chatkit.response.start", onResponseStart as EventListener);
      element.addEventListener("chatkit.response.end", onResponseEnd as EventListener);
      element.addEventListener("thread.item.assistant_message", onAssistantMessage as EventListener);

      detach = () => {
        element.removeEventListener("chatkit.thread.change", onThreadChange as EventListener);
        element.removeEventListener("chatkit.response.start", onResponseStart as EventListener);
        element.removeEventListener("chatkit.response.end", onResponseEnd as EventListener);
        element.removeEventListener("thread.item.assistant_message", onAssistantMessage as EventListener);
        if (attachedElement.current === element) {
          attachedElement.current = null;
        }
      };
    };

    attachIfNeeded();
    const interval = window.setInterval(() => {
      if (cancelled) return;
      attachIfNeeded();
    }, 400);

    return () => {
      cancelled = true;
      if (detach) detach();
      window.clearInterval(interval);
    };
  }, [chatkitRef, fetchLatestAssistant, handleAssistantDetail, stop]);

  return { speakText, stop };
}
