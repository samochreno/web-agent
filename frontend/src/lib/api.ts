export type UserProfile = { id: string; email: string; name?: string | null };
export type GoogleStatus = { connected: boolean; email?: string | null; expires_at?: string | null };
export type PromptInfo = { id?: string | null };

export type SessionResponse = {
  user?: UserProfile | null;
  google?: GoogleStatus;
  prompt?: PromptInfo;
  realtime?: { model?: string | null; voice?: string | null };
};

export type CalendarOption = {
  id: string;
  name?: string;
  primary?: boolean;
  access_role?: string;
  readonly?: boolean;
  selected?: boolean;
};

async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    ...init,
  });

  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }

  return payload as T;
}

export async function getSession(): Promise<SessionResponse> {
  return fetchJson<SessionResponse>("/api/auth/session");
}

export async function googleAuthUrl(): Promise<{ url: string }> {
  return fetchJson<{ url: string }>("/api/google/auth-url");
}

export async function disconnectGoogle() {
  return fetchJson<{ disconnected: boolean }>("/api/google/disconnect", { method: "POST" });
}

export async function loadCalendars(): Promise<{ calendars: CalendarOption[] }> {
  return fetchJson<{ calendars: CalendarOption[] }>("/api/calendars");
}

export async function updateVisibleCalendars(calendars: string[]) {
  return fetchJson<{ calendars: CalendarOption[] }>("/api/calendars/visible", {
    method: "POST",
    body: JSON.stringify({ calendars }),
  });
}

export type RealtimeSessionConfig = {
  client_secret: { value: string; expires_at?: number | string | null };
  url?: string | null;
  expires_after?: number | null;
  model?: string;
  voice?: string;
  prompt_id?: string;
};

export async function createRealtimeSession(promptId?: string): Promise<RealtimeSessionConfig> {
  return fetchJson<RealtimeSessionConfig>("/api/realtime/session", {
    method: "POST",
    body: JSON.stringify(promptId ? { prompt: { id: promptId } } : {}),
  });
}
