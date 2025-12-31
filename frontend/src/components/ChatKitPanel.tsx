import { useMemo } from "react";
import { ChatKit, useChatKit } from "@openai/chatkit-react";
import { createClientSecretFetcher, workflowId } from "../lib/chatkitSession";

type Props = {
  className?: string;
};

export function ChatKitPanel({ className }: Props) {
  const getClientSecret = useMemo(() => createClientSecretFetcher(workflowId), []);

  const chatkit = useChatKit({
    api: { getClientSecret },
  });

  return (
    <div className={`w-full ${className ?? ""}`}>
      <div className="h-[calc(100svh-12rem)] min-h-[420px] w-full rounded-xl border border-slate-200 bg-white shadow-sm dark:bg-slate-900">
        <ChatKit control={chatkit.control} className="w-full" />
      </div>
    </div>
  );
}
