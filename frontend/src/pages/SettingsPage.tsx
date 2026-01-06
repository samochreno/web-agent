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
      setCalendarError(
        err instanceof Error ? err.message : "Unable to load calendars"
      );
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
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="relative w-full overflow-hidden rounded-[28px] border border-slate-200/70 bg-gradient-to-b from-slate-50 via-white to-slate-100 px-5 py-6 shadow-xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(14,165,233,0.08),transparent_32%),radial-gradient(circle_at_80%_0%,rgba(99,102,241,0.06),transparent_32%),radial-gradient(circle_at_50%_80%,rgba(52,211,153,0.05),transparent_30%)]" />

        <div className="relative flex flex-col gap-6">
          {/* Account Section */}
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm backdrop-blur">
            <div className="flex items-center gap-2 pb-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <h3 className="text-base font-semibold text-slate-900">
                Account
              </h3>
            </div>
            {session.user ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-sky-500 text-sm font-bold text-white shadow-md">
                    {session.user.email.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {session.user.email}
                    </p>
                    {session.user.name ? (
                      <p className="text-sm text-slate-600">
                        {session.user.name}
                      </p>
                    ) : null}
                  </div>
                </div>
                <button
                  onClick={() => void handleLogout()}
                  className="w-fit rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <LoginForm onLogin={handleLogin} />
            )}
            <p className="pt-2 text-xs text-slate-500">
              Sessions are stored in a secure cookie. Use a recognizable email
              so tool calls and state variables stay scoped to you.
            </p>
          </div>

          {/* Google Connection Section */}
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm backdrop-blur">
            <div className="flex items-center gap-2 pb-2">
              <span className="h-2 w-2 rounded-full bg-sky-500" />
              <h3 className="text-base font-semibold text-slate-900">
                Google Connection
              </h3>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              Connect Google to unlock the scheduling tools. IDs stay masked
              through aliasing so the model never sees raw Google identifiers.
            </p>
            {googleNotice ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 shadow-inner">
                Google connected — you can now choose which calendars are
                shared.
              </div>
            ) : null}
            <div className="flex items-center gap-3 flex-wrap">
              <span
                className={`flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] font-semibold shadow-sm ${
                  session.google.connected
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-slate-50 text-slate-600"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    session.google.connected
                      ? "bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.2)]"
                      : "bg-slate-400"
                  }`}
                />
                {session.google.connected ? "Connected" : "Disconnected"}
              </span>
              <span className="text-sm text-slate-600">
                {session.google.connected
                  ? session.google.email || "Google account"
                  : "No Google account linked"}
              </span>
            </div>
            <div className="flex items-center gap-2 pt-1">
              {session.google.connected ? (
                <button
                  onClick={() => void handleGoogleDisconnect()}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-slate-50"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={() => void handleGoogleConnect()}
                  className="rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-400"
                >
                  Connect Google
                </button>
              )}
            </div>
            <p className="pt-2 text-xs text-slate-500">
              Selecting calendars controls which ones feed into list_events,
              with readonly flags applied for shared calendars.
            </p>
          </div>

          {/* Calendar Visibility Section */}
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm backdrop-blur">
            <div className="flex items-center gap-2 pb-2">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              <h3 className="text-base font-semibold text-slate-900">
                Calendar Visibility
              </h3>
            </div>
            {session.google.connected ? (
              <div className="space-y-3">
                {loadingCalendars ? (
                  <p className="text-sm text-slate-500">Loading calendars…</p>
                ) : calendarError ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 shadow-inner">
                    {calendarError}
                  </div>
                ) : (
                  <CalendarSelector
                    calendars={calendars}
                    onChange={handleCalendarChange}
                  />
                )}
                <p className="text-xs text-slate-500">
                  Primary calendars are always included. Readonly calendars
                  appear in agent responses but tool updates are blocked to keep
                  shared data safe.
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-600">
                Connect your Google account to pick which calendars are shared
                with the agent. Primary will always be included with aliases.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
