import { getApiBaseUrl } from "./config";

type CapacitorHttpPayload = {
  status: number;
  data: unknown;
  headers?: Record<string, string>;
};

function isCapacitorHttpPayload(value: unknown): value is CapacitorHttpPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    typeof (value as Record<string, unknown>).status === "number" &&
    "data" in value &&
    typeof (value as Record<string, unknown>).data !== "undefined" &&
    "headers" in value &&
    (typeof (value as Record<string, unknown>).headers === "object" ||
      typeof (value as Record<string, unknown>).headers === "undefined")
  );
}

export function normalizeApiResponsePayload<T>(value: unknown): T {
  // CapacitorHttp returns the JSON body under `data` with status/headers alongside.
  if (isCapacitorHttpPayload(value)) {
    return normalizeApiResponsePayload<T>((value as CapacitorHttpPayload).data);
  }
  // Some environments hand us a JSON string; try to parse then re-run normalization.
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return normalizeApiResponsePayload<T>(parsed);
    } catch {
      // fall through and return the raw string
    }
  }
  return value as T;
}

export type UserProfile = { id: string; email: string; name?: string | null };
export type GoogleStatus = {
  connected: boolean;
  email?: string | null;
  expires_at?: string | null;
};
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
  // Prepend the API base URL for native platforms
  const url = `${getApiBaseUrl()}${path}`;

  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    ...init,
  });

  const payload = (await response.json().catch(() => ({})));
  const normalizedPayload = normalizeApiResponsePayload<unknown>(payload);
  const normalizedError =
    (normalizedPayload &&
      typeof normalizedPayload === "object" &&
      "error" in normalizedPayload &&
      (normalizedPayload as { error?: string }).error) ||
    (payload as { error?: string }).error;
  if (!response.ok) {
    throw new Error(normalizedError || "Request failed");
  }

  return normalizedPayload as T;
}

export async function getSession(): Promise<SessionResponse> {
  return fetchJson<SessionResponse>("/api/auth/session");
}

export async function googleAuthUrl(
  redirectUri?: string,
  nativeScheme?: string
): Promise<{ url: string }> {
  const params = new URLSearchParams();
  if (redirectUri) params.set("redirect_uri", redirectUri);
  if (nativeScheme) params.set("native", nativeScheme);
  const queryString = params.toString();
  return fetchJson<{ url: string }>(
    `/api/google/auth-url${queryString ? `?${queryString}` : ""}`
  );
}

export async function disconnectGoogle() {
  return fetchJson<{ disconnected: boolean }>("/api/google/disconnect", {
    method: "POST",
  });
}

export async function loadCalendars(): Promise<{
  calendars: CalendarOption[];
}> {
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

export type TriggerReminder = {
  id: string;
  text: string;
  trigger_type: string;
  status: string;
  created_at?: string;
  fired_at?: string | null;
  google_task_id?: string | null;
  google_task_alias?: string | null;
  task_list_id?: string | null;
  task_error?: string | null;
};

export async function createRealtimeSession(
  promptId?: string,
  signal?: AbortSignal
): Promise<RealtimeSessionConfig> {
  return fetchJson<RealtimeSessionConfig>("/api/realtime/session", {
    method: "POST",
    body: JSON.stringify(promptId ? { prompt: { id: promptId } } : {}),
    signal,
  });
}

export async function callRealtimeTool(
  payload: { name: string; arguments: unknown }
): Promise<{ result?: unknown; error?: string }> {
  return fetchJson<{ result?: unknown; error?: string }>("/api/realtime/tool", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listReminders(): Promise<{ reminders: TriggerReminder[] }> {
  return fetchJson<{ reminders: TriggerReminder[] }>("/api/reminders");
}

export async function fireReminders(triggerType: string): Promise<{
  trigger_type: string;
  reminders: TriggerReminder[];
  error?: string;
}> {
  return fetchJson<{
    trigger_type: string;
    reminders: TriggerReminder[];
    error?: string;
  }>("/api/reminders/trigger", {
    method: "POST",
    body: JSON.stringify({ trigger_type: triggerType }),
  });
}
