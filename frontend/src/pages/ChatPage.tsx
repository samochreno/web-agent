import { ChatKitPanel } from "../components/ChatKitPanel";
import type { SessionState } from "../types";

type Props = {
  session: SessionState;
};

export function ChatPage({ session }: Props) {
  const workflowId = session.workflow?.id ?? "unknown";

  return (
    <div
      className="w-full h-[calc(100svh-56px)] mx-auto flex max-w-6xl flex-col"
      data-workflow-id={workflowId}
    >
      <ChatKitPanel className="h-full" />
    </div>
  );
}
