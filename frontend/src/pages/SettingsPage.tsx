import { useEffect, useState } from "react";
import { CalendarSelector } from "../components/CalendarSelector";
import {
  disconnectGoogle,
  googleAuthUrl,
  loadCalendars,
  updateVisibleCalendars,
  type CalendarOption,
} from "../lib/api";
import {
  openAuthUrl,
  listenForOAuthCallback,
  getOAuthRedirectUri,
  getNativeScheme,
} from "../lib/auth";
import { isNativePlatform } from "../lib/config";
import type { SessionState } from "../types";

type Props = {
  session: SessionState;
  refreshSession: () => Promise<void>;
};

export function SettingsPage({ session, refreshSession }: Props) {
  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  // Listen for OAuth callbacks on native platforms
  useEffect(() => {
    const cleanup = listenForOAuthCallback(async (success) => {
      setAuthLoading(false);
      if (success) {
        await refreshSession();
      } else {
        setCalendarError("Google authentication failed");
      }
    });

    return cleanup;
  }, [refreshSession]);

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

  const handleGoogleConnect = async () => {
    setAuthLoading(true);
    setCalendarError(null);
    try {
      // Pass redirect URI and native scheme for native apps
      const redirectUri = getOAuthRedirectUri();
      const nativeScheme = getNativeScheme();
      const { url } = await googleAuthUrl(redirectUri, nativeScheme);
      await openAuthUrl(url);
      // On web, this will redirect away, so we won't reach here
      // On native, the browser opens and we wait for the deep link callback
      if (!isNativePlatform()) {
        // Reset loading state only for native (web will navigate away)
        setAuthLoading(false);
      }
    } catch (err) {
      setCalendarError(
        err instanceof Error ? err.message : "Failed to start authentication"
      );
      setAuthLoading(false);
    }
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
    <div className="flex h-full w-full flex-col bg-white">
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 py-8 space-y-8">
          {/* Google Connection Section */}
          <section>
            <h2 className="text-sm font-medium text-slate-500 mb-4">
              Google Connection
            </h2>
            <p className="text-sm text-slate-600 mb-4">
              Connect Google to unlock the scheduling tools. IDs stay masked
              through aliasing so the model never sees raw Google identifiers.
            </p>

            <div className="flex items-center gap-3 mb-4">
              <span
                className={`h-2 w-2 rounded-full ${
                  session.google.connected ? "bg-emerald-500" : "bg-slate-300"
                }`}
              />
              <span className="text-sm text-slate-700">
                {session.google.connected
                  ? session.google.email || "Connected"
                  : "Not connected"}
              </span>
            </div>

            {session.google.connected ? (
              <button
                onClick={() => void handleGoogleDisconnect()}
                className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={() => void handleGoogleConnect()}
                disabled={authLoading}
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {authLoading ? "Connecting…" : "Connect Google"}
              </button>
            )}

            <p className="mt-4 text-xs text-slate-400">
              Selecting calendars controls which ones feed into list_events,
              with readonly flags applied for shared calendars.
            </p>
          </section>

          <hr className="border-slate-100" />

          {/* Calendar Visibility Section */}
          <section>
            <h2 className="text-sm font-medium text-slate-500 mb-4">
              Calendar Visibility
            </h2>

            {session.google.connected ? (
              <div className="space-y-4">
                {loadingCalendars ? (
                  <p className="text-sm text-slate-500">Loading calendars…</p>
                ) : calendarError ? (
                  <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
                    {calendarError}
                  </div>
                ) : (
                  <CalendarSelector
                    calendars={calendars}
                    onChange={handleCalendarChange}
                  />
                )}
                <p className="text-xs text-slate-400">
                  Primary calendars are always included. Readonly calendars
                  appear in agent responses but tool updates are blocked to keep
                  shared data safe.
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                Connect your Google account to pick which calendars are shared
                with the agent.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
