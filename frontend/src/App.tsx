import { useCallback, useEffect, useState } from "react";
import { NavBar } from "./components/NavBar";
import { Sidebar } from "./components/Sidebar";
import { ChatPage } from "./pages/ChatPage";
import { SettingsPage } from "./pages/SettingsPage";
import { getSession } from "./lib/api";
import {
  emptySessionState,
  type SessionState,
  type ConnectionState,
} from "./types";

const routes = ["/", "/settings"];

export default function App() {
  const [session, setSession] = useState<SessionState>(emptySessionState);
  const [route, setRoute] = useState<string>(resolveRoute());
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [isOutputAudioBufferActive, setIsOutputAudioBufferActive] =
    useState(false);
  const [connectionHandlers, setConnectionHandlers] = useState<{
    connect: () => void;
    disconnect: () => void;
  } | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const isSettings = route === "/settings";

  const navigate = (path: string) => {
    const normalized = routes.includes(path) ? path : "/";
    if (window.location.pathname !== normalized) {
      const search = window.location.search;
      window.history.pushState({}, "", `${normalized}${search}`);
    }
    setRoute(normalized);
  };

  useEffect(() => {
    const handler = () => setRoute(resolveRoute());
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  const refreshSession = useCallback(async () => {
    setSession((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const next = await getSession();
      setSession({
        loading: false,
        error: null,
        user: next.user ?? null,
        google: next.google ?? {
          connected: false,
          email: null,
          expires_at: null,
        },
        prompt: next.prompt,
        realtime: next.realtime,
      });
    } catch (err) {
      setSession((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "Unable to load session",
      }));
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  return (
    <main className="flex h-screen bg-slate-100 overflow-hidden">
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        currentPath={route}
        onNavigate={navigate}
      />
      <div className="flex flex-1 flex-col min-w-0">
        <NavBar
          session={session}
          connectionState={connectionState}
          isOutputAudioBufferActive={isOutputAudioBufferActive}
          onConnect={connectionHandlers?.connect}
          onDisconnect={connectionHandlers?.disconnect}
          showConnectionControls={!isSettings}
          onMenuClick={() => setIsSidebarOpen(true)}
        />
        <div
          className={`flex flex-1 min-h-0 flex-col ${
            isSettings ? "overflow-y-auto" : "overflow-hidden"
          }`}
        >
          {session.error ? (
            <div className="mx-auto mt-4 max-w-4xl rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {session.error}
            </div>
          ) : null}
          {isSettings ? (
            <SettingsPage session={session} refreshSession={refreshSession} />
          ) : (
            <ChatPage
              session={session}
              onConnectionStateChange={setConnectionState}
              onOutputAudioBufferActiveChange={setIsOutputAudioBufferActive}
              onConnectionHandlersReady={setConnectionHandlers}
            />
          )}
        </div>
      </div>
    </main>
  );
}

function resolveRoute(): string {
  return routes.includes(window.location.pathname)
    ? window.location.pathname
    : "/";
}
