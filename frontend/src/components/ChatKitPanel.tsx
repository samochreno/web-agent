import { useCallback, useMemo } from "react";
import { ChatKit, useChatKit } from "@openai/chatkit-react";
import { createClientSecretFetcher, workflowId } from "../lib/chatkitSession";
import { VoiceToggleButton } from "./VoiceToggleButton";
import { useVoiceMode } from "../hooks/useVoiceMode";
import { useVoicePlayback } from "../hooks/useVoicePlayback";

type Props = {
  className?: string;
};

export function ChatKitPanel({ className }: Props) {
  const getClientSecret = useMemo(
    () => createClientSecretFetcher(workflowId),
    []
  );
  const onClientTool = useCallback(
    async (toolCall: { name: string; params: Record<string, unknown> }) => {
      const response = await fetch("/api/chatkit/tool", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: toolCall.name,
          arguments: toolCall.params ?? {},
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        result?: Record<string, unknown>;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to run tool");
      }
      return payload.result ?? {};
    },
    []
  );

  const chatkit = useChatKit({
    api: { getClientSecret },
    onClientTool,
  });

  const handleVoiceText = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      await chatkit.sendUserMessage({ text });
    },
    [chatkit]
  );

  const voice = useVoiceMode({ onTranscription: handleVoiceText });
  useVoicePlayback({ enabled: voice.active, chatkitRef: chatkit.ref });

  return (
    <div className={`relative w-full ${className ?? ""}`}>
      <ChatKit control={chatkit.control} className="w-full" />
      <div className="pointer-events-none absolute bottom-4 right-4 flex flex-col items-end gap-2">
        <div className="pointer-events-auto">
          <VoiceToggleButton
            active={voice.active}
            status={voice.phase}
            disabled={voice.phase === "preparing" || voice.phase === "stopping"}
            onToggle={() => void voice.toggle()}
          />
        </div>
        <div className="pointer-events-auto rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-800 shadow-sm ring-1 ring-slate-200">
          {voice.label}
        </div>
        {voice.error ? (
          <div className="pointer-events-auto rounded-md bg-amber-100 px-3 py-1 text-xs text-amber-900 shadow-sm ring-1 ring-amber-200">
            {voice.error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
