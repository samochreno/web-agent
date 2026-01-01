import { ChatKitPanel } from "../components/ChatKitPanel";
import { InfoCard } from "../components/InfoCard";
import type { SessionState } from "../types";

type Props = {
  session: SessionState;
};

export function ChatPage({ session }: Props) {
  const workflowId = session.workflow?.id || "Not configured";
  const workflowVersion = session.workflow?.version || "latest";

  return (
    <div className="w-full h-[calc(100svh-56px)] mx-auto flex max-w-6xl flex-col">
      <ChatKitPanel className="h-full" />
    </div>
  );
}
