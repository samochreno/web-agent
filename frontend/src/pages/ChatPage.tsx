import type { SessionState, ConnectionState } from "../types";
import { RealtimePanel } from "../components/RealtimePanel";

type Props = {
  session: SessionState;
  onConnectionStateChange: (state: ConnectionState) => void;
  onOutputAudioBufferActiveChange: (active: boolean) => void;
  onConnectionHandlersReady: (handlers: {
    connect: () => void;
    disconnect: () => void;
  }) => void;
};

export function ChatPage({
  session,
  onConnectionStateChange,
  onOutputAudioBufferActiveChange,
  onConnectionHandlersReady,
}: Props) {
  return (
    <div className="flex w-full flex-1 flex-col min-h-0 overflow-hidden">
      <RealtimePanel
        className="flex-1 min-h-0"
        promptId={session.prompt?.id ?? undefined}
        onConnectionStateChange={onConnectionStateChange}
        onOutputAudioBufferActiveChange={onOutputAudioBufferActiveChange}
        onConnectionHandlersReady={onConnectionHandlersReady}
      />
    </div>
  );
}
