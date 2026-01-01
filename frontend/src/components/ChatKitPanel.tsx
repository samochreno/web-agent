import { useCallback, useMemo } from "react";
import { ChatKit, useChatKit } from "@openai/chatkit-react";
import { createClientSecretFetcher, workflowId } from "../lib/chatkitSession";

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

  return (
    <div className={`w-full ${className ?? ""}`}>
      <ChatKit control={chatkit.control} className="w-full" />
    </div>
  );
}
