import type { GoogleStatus, PromptInfo, UserProfile } from "./lib/api";

export type SessionState = {
  loading: boolean;
  error?: string | null;
  user: UserProfile | null;
  google: GoogleStatus;
  prompt?: PromptInfo;
  realtime?: { model?: string | null; voice?: string | null };
};

export const emptySessionState: SessionState = {
  loading: true,
  error: null,
  user: null,
  google: { connected: false, email: null, expires_at: null },
  prompt: {},
  realtime: {},
};
