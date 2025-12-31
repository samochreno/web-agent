import { useMemo } from "react";
import { ChatKit, useChatKit } from "@openai/chatkit-react";
import { createClientSecretFetcher, workflowId } from "../lib/chatkitSession";

export function ChatKitPanel() {
  const getClientSecret = useMemo(
    () => createClientSecretFetcher(workflowId),
    []
  );

  const chatkit = useChatKit({
    api: { getClientSecret },
  });

  return (
    <div
      style={{ ["--toolbar-height" as any]: "3rem" }}
      className="max-w-5xl mx-auto w-full flex flex-col items-stretch"
    >
      <div className="h-[3rem] bg-slate-100"></div>
      <div className="h-[calc(100svh-3rem)] w-full rounded-2xl bg-white shadow-sm transition-colors dark:bg-slate-900">
        <ChatKit control={chatkit.control} className="w-full" />
      </div>
    </div>
  );
}
