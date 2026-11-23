/** The sync API's origin; the browser talks to it directly, carrying the API's own session cookie. */
export const API_URL = import.meta.env.VITE_SYNC_API_URL ?? "http://localhost:3006";

export type Side = "ghost" | "github";
export const HOST: Record<Side, "Ghost" | "GitHub"> = { ghost: "Ghost", github: "GitHub" };
export type SyncStatus = "backfilling" | "active" | "paused" | "disconnected" | "error";

export type Sync = {
  id: string;
  ghostFullName: string;
  githubFullName: string;
  status: SyncStatus;
  lastError: string | null;
  disconnectReason: string | null;
  lastReconciledAt: string | null;
  createdAt: string;
};

export type FlaggedRef = { name: string; ghost: string | null; github: string | null; reason: string };
export type Activity = { at: string; direction: Side | null; kind: string; summary: string; error: string | null };
export type LinkKind = "issue" | "pull" | "comment" | "review" | "review_comment" | "label" | "check_run";
/** Branches and tags in agreement, and paired items of each kind. */
export type SyncCounts = { refs: number } & Partial<Record<LinkKind, number>>;
export type SyncDetail = { sync: Sync; flagged: FlaggedRef[]; counts: SyncCounts; activity: Activity[]; installUrl: Record<Side, string>; webUrl: Record<Side, string> };
export type Me = { ghost: { login: string } | null; github: { login: string } | null };
export type Repository = { id: string; fullName: string; private: boolean; synced: boolean };
export type Repositories = { installUrl: string; repositories: Repository[] };
export type Preview = {
  branches: { toGhost: number; toGitHub: number; diverged: number };
  issues: { toGhost: number; toGitHub: number };
  pulls: { toGhost: number; toGitHub: number };
};
export type NewSync = {
  ghost: { fullName: string };
  github: { fullName: string } | { create: { owner: string; name: string; private: boolean } };
  /** False copies only what happens after the sync starts. */
  backfill: boolean;
};

/** An answer the API refused, with its message meant for people and, when an app is missing, where to install it. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly installUrl: string | null,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: init.method ?? "GET",
    credentials: "include",
    headers: init.body === undefined ? undefined : { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = (await response.json().catch(() => null)) as { error?: string; installUrl?: string } | null;
  if (!response.ok) throw new ApiError(response.status, body?.error ?? `The sync API answered ${response.status}.`, body?.installUrl ?? null);
  return body as T;
}
