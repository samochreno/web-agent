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
    const currentHash = window.location.hash.slice(1) || "/";
    if (currentHash !== normalized) {
      window.location.hash = normalized;
    }
    // Reset connection state when navigating away from chat
    // The RealtimePanel will be unmounted and its cleanup will disconnect,
    // but state updates during unmount may not propagate correctly
    if (normalized !== "/") {
      setConnectionState("disconnected");
      setIsOutputAudioBufferActive(false);
      setConnectionHandlers(null);
    }
    setRoute(normalized);
  };

  useEffect(() => {
    const handler = () => {
      const newRoute = resolveRoute();
      // Reset connection state when navigating away from chat via browser navigation
      if (newRoute !== "/") {
        setConnectionState("disconnected");
        setIsOutputAudioBufferActive(false);
        setConnectionHandlers(null);
      }
      setRoute(newRoute);
    };
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
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
    <main className="flex h-[100dvh] bg-slate-100 overflow-hidden">
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
  const hash = window.location.hash.slice(1) || "/";
  const path = hash.split("?")[0] || "/";
  return routes.includes(path) ? path : "/";
}
