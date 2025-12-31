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
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
      <div className="grid gap-4 md:grid-cols-2">
        <InfoCard
          title="Workflow context"
          footer="State variables include date, time, day, and cached task lists from Google when available."
        >
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">Workflow ID</dt>
            <dd className="font-semibold text-slate-900">{workflowId}</dd>
            <dt className="text-slate-500">Version</dt>
            <dd className="font-semibold text-slate-900">{workflowVersion}</dd>
            <dt className="text-slate-500">Google</dt>
            <dd className="font-semibold text-slate-900">
              {session.google.connected ? `Connected as ${session.google.email ?? "user"}` : "Not connected"}
            </dd>
          </dl>
        </InfoCard>
        <InfoCard
          title="Tool + calendar safety"
          footer="Default event windows come from the backend (start time + duration) and timezone-aware parsing."
        >
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Google task lists, tasks, and events are wrapped in numeric aliases so the agent never sees raw Google IDs.
            </li>
            <li>
              Shared calendars are merged into <code className="rounded bg-slate-100 px-1">list_events</code> responses
              and marked readonly; edits are blocked.
            </li>
            <li>
              Tool calls follow the Agent Builder schema from the legacy app: date-only tasks, local-time events, and
              masked calendar IDs.
            </li>
          </ul>
        </InfoCard>
      </div>
      <div className="rounded-2xl bg-white p-3 shadow-sm">
        <ChatKitPanel />
      </div>
    </div>
  );
}
