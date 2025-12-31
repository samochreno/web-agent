import { useCallback, useEffect, useState } from "react";
import { NavBar } from "./components/NavBar";
import { ChatPage } from "./pages/ChatPage";
import { SettingsPage } from "./pages/SettingsPage";
import { getSession } from "./lib/api";
import { emptySessionState, type SessionState } from "./types";

const routes = ["/", "/settings"];

export default function App() {
  const [session, setSession] = useState<SessionState>(emptySessionState);
  const [route, setRoute] = useState<string>(resolveRoute());

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
        google: next.google ?? { connected: false, email: null, expires_at: null },
        workflow: next.workflow,
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
    <main className="min-h-screen bg-slate-100 dark:bg-slate-950">
      <NavBar currentPath={route} onNavigate={navigate} session={session} />
      {session.error ? (
        <div className="mx-auto mt-4 max-w-4xl rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {session.error}
        </div>
      ) : null}
      {route === "/settings" ? (
        <SettingsPage session={session} refreshSession={refreshSession} />
      ) : (
        <ChatPage session={session} />
      )}
    </main>
  );
}

function resolveRoute(): string {
  return routes.includes(window.location.pathname) ? window.location.pathname : "/";
}
