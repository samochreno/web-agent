import { useEffect, useMemo, useState } from "react";
import { CalendarSelector } from "../components/CalendarSelector";
import { InfoCard } from "../components/InfoCard";
import { LoginForm } from "../components/LoginForm";
import {
  disconnectGoogle,
  googleAuthUrl,
  loadCalendars,
  login,
  logout,
  updateVisibleCalendars,
  type CalendarOption,
} from "../lib/api";
import type { SessionState } from "../types";

type Props = {
  session: SessionState;
  refreshSession: () => Promise<void>;
};

export function SettingsPage({ session, refreshSession }: Props) {
  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [loadingCalendars, setLoadingCalendars] = useState(false);

  const googleNotice = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("google") === "connected";
  }, []);

  useEffect(() => {
    if (session.google.connected) {
      void fetchCalendars();
    } else {
      setCalendars([]);
    }
  }, [session.google.connected]);

  const fetchCalendars = async () => {
    setLoadingCalendars(true);
    setCalendarError(null);
    try {
      const response = await loadCalendars();
      setCalendars(response.calendars || []);
    } catch (err) {
      setCalendarError(err instanceof Error ? err.message : "Unable to load calendars");
    } finally {
      setLoadingCalendars(false);
    }
  };

  const handleLogin = async (email: string, name?: string) => {
    await login(email, name);
    await refreshSession();
  };

  const handleLogout = async () => {
    await logout();
    await refreshSession();
    setCalendars([]);
  };

  const handleGoogleConnect = async () => {
    const { url } = await googleAuthUrl();
    window.location.href = url;
  };

  const handleGoogleDisconnect = async () => {
    await disconnectGoogle();
    await refreshSession();
    setCalendars([]);
  };

  const handleCalendarChange = async (selected: string[]) => {
    const response = await updateVisibleCalendars(selected);
    setCalendars(response.calendars || []);
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
      <div className="grid gap-4 md:grid-cols-2">
        <InfoCard
          title="Account"
          footer="Sessions are stored in a secure cookie. Use a recognizable email so tool calls and state variables stay scoped to you."
        >
          {session.user ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-slate-900">{session.user.email}</p>
              {session.user.name ? <p className="text-sm text-slate-700">{session.user.name}</p> : null}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void handleLogout()}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Sign out
                </button>
              </div>
            </div>
          ) : (
            <LoginForm onLogin={handleLogin} />
          )}
        </InfoCard>
        <InfoCard title="ChatKit workflow">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">Workflow ID</dt>
            <dd className="font-semibold text-slate-900">{session.workflow?.id || "Not configured"}</dd>
            <dt className="text-slate-500">Version</dt>
            <dd className="font-semibold text-slate-900">{session.workflow?.version || "latest"}</dd>
            <dt className="text-slate-500">State variables</dt>
            <dd className="text-slate-800">date, time, day, cached task lists</dd>
          </dl>
        </InfoCard>
      </div>

      <InfoCard
        title="Google connection + shared calendars"
        footer="Selecting calendars controls which ones feed into list_events, with readonly flags applied for shared calendars."
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-700">
            Connect Google to unlock the scheduling tools. IDs stay masked through aliasing so the model never sees raw
            Google identifiers, and readonly shared calendars are filtered into the tool output with write protection.
          </p>
          {googleNotice ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              Google connected — you can now choose which calendars are shared.
            </div>
          ) : null}
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-800">
              {session.google.connected ? "Connected" : "Disconnected"}
            </span>
            <span className="text-sm text-slate-700">
              {session.google.connected ? session.google.email || "Google account" : "No Google account linked"}
            </span>
            <div className="flex items-center gap-2">
              {session.google.connected ? (
                <button
                  onClick={() => void handleGoogleDisconnect()}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={() => void handleGoogleConnect()}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Connect Google
                </button>
              )}
            </div>
          </div>
        </div>
      </InfoCard>

      <InfoCard title="Calendar visibility">
        {session.google.connected ? (
          <div className="space-y-3">
            {loadingCalendars ? (
              <p className="text-sm text-slate-500">Loading calendars…</p>
            ) : calendarError ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {calendarError}
              </div>
            ) : (
              <CalendarSelector calendars={calendars} onChange={handleCalendarChange} />
            )}
            <p className="text-xs text-slate-500">
              Primary calendars are always included. Readonly calendars appear in agent responses but tool updates are
              blocked to keep shared data safe.
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-600">
            Connect your Google account to pick which calendars are shared with the agent. Primary will always be
            included with aliases.
          </p>
        )}
      </InfoCard>
    </div>
  );
}
