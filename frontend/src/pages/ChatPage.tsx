import type { SessionState } from "../types";
import { RealtimePanel } from "../components/RealtimePanel";

type Props = {
  session: SessionState;
};

export function ChatPage({ session }: Props) {
  return (
    <div className="w-full h-[calc(100svh-56px)] mx-auto flex max-w-6xl flex-col">
      <RealtimePanel
        className="h-full"
        promptId={session.prompt?.id ?? undefined}
        model={session.realtime?.model ?? undefined}
        voice={session.realtime?.voice ?? undefined}
      />
    </div>
  );
}
