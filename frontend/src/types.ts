import type { GoogleStatus, UserProfile, WorkflowInfo } from "./lib/api";

export type SessionState = {
  loading: boolean;
  error?: string | null;
  user: UserProfile | null;
  google: GoogleStatus;
  workflow?: WorkflowInfo;
};

export const emptySessionState: SessionState = {
  loading: true,
  error: null,
  user: null,
  google: { connected: false, email: null, expires_at: null },
  workflow: {},
};
