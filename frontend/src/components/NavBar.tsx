import type { SessionState, ConnectionState } from "../types";
import { useMemo } from "react";

type Props = {
  session: SessionState;
  connectionState: ConnectionState;
  isOutputAudioBufferActive: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  showConnectionControls: boolean;
  onMenuClick: () => void;
};

export function NavBar({
  session,
  connectionState,
  isOutputAudioBufferActive,
  onConnect,
  onDisconnect,
  showConnectionControls,
  onMenuClick,
}: Props) {
  const headerStatus = useMemo(() => {
    if (connectionState === "connected") return "Live";
    if (connectionState === "connecting") return "Connecting";
    return "Disconnected";
  }, [connectionState]);

  const statusBadgeClass = useMemo(() => {
    if (connectionState === "connected") {
      return "bg-emerald-100 text-emerald-800";
    }
    if (connectionState === "connecting") {
      return "bg-amber-100 text-amber-800";
    }
    return "bg-slate-100 text-slate-600";
  }, [connectionState]);

  return (
    <header className="sticky top-0 z-30 w-full border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="flex items-center justify-between px-4 py-3 h-12 pt-[max(12px,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          {/* Hamburger menu button */}
          <button
            onClick={onMenuClick}
            className="flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-5 w-5"
            >
              <path
                fillRule="evenodd"
                d="M3 6.75A.75.75 0 0 1 3.75 6h16.5a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 6.75ZM3 12a.75.75 0 0 1 .75-.75h16.5a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 12Zm0 5.25a.75.75 0 0 1 .75-.75h16.5a.75.75 0 0 1 0 1.5H3.75a.75.75 0 0 1-.75-.75Z"
                clipRule="evenodd"
              />
            </svg>
          </button>

          {showConnectionControls && (
            <>
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${
                    connectionState === "connected"
                      ? "bg-emerald-500"
                      : connectionState === "connecting"
                      ? "bg-amber-500 animate-pulse"
                      : "bg-slate-400"
                  }`}
                />
                <span className="text-sm font-medium text-slate-700">Luna</span>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadgeClass}`}
              >
                {headerStatus}
              </span>
              {isOutputAudioBufferActive && (
                <span className="flex items-center gap-1.5 text-xs text-emerald-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Speaking
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {showConnectionControls && (
            <button
              onClick={
                connectionState === "disconnected" ? onConnect : onDisconnect
              }
              disabled={!onConnect || !onDisconnect}
              className={`rounded-full px-4 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                connectionState === "disconnected"
                  ? "bg-emerald-500 text-white hover:bg-emerald-600"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {connectionState === "disconnected"
                ? "Connect"
                : connectionState === "connecting"
                ? "Connecting..."
                : "Disconnect"}
            </button>
          )}
          {/* {session.user ? (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-800">
              Logged in
            </span>
          ) : (
            <span className="text-sm text-slate-500">Not logged in</span>
          )} */}
        </div>
      </div>
    </header>
  );
}
