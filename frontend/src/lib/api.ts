export type UserProfile = { id: string; email: string; name?: string | null };
export type GoogleStatus = { connected: boolean; email?: string | null; expires_at?: string | null };
export type WorkflowInfo = { id?: string | null; version?: string | null };

export type SessionResponse = {
  user?: UserProfile | null;
  google?: GoogleStatus;
  workflow?: WorkflowInfo;
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

export async function login(email: string, name?: string) {
  return fetchJson<{ user: UserProfile }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, name }),
  });
}

export async function logout() {
  return fetchJson<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
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
