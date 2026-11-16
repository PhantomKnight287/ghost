import type { Side } from "../side.ts";

/** One unit of sync work, stored as a queued job, so it is plain data rather than a closure. */
export type SyncAction =
  | { kind: "refs"; refs: string[] }
  | { kind: "pull"; from: Side; number: number }
  | { kind: "review"; from: Side; pullNumber: number; key: string }
  | { kind: "review_comment"; from: Side; pullNumber: number; key: string; deleted: boolean }
  | { kind: "issue"; from: Side; number: number; deleted: boolean }
  | { kind: "comment"; from: Side; issueNumber: number; key: string; deleted: boolean }
  | { kind: "label"; from: Side; name: string; deleted: boolean }
  | { kind: "check_run"; from: Side; id: string }
  | { kind: "sync_check"; sha: string }
  | { kind: "reconcile" };
