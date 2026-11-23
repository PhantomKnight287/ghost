import type { Side } from "../side.ts";

/** One unit of sync work, stored as a queued job, so it is plain data rather than a closure. */
export type SyncAction =
  | { kind: "refs"; refs: string[] }
  | { kind: "pull"; from: Side; number: number }
  | { kind: "review"; from: Side; pullNumber: number; key: string }
  | { kind: "review_comment"; from: Side; pullNumber: number; key: string; deleted: boolean }
  | { kind: "issue"; from: Side; number: number; deleted: boolean }
  | { kind: "comment"; from: Side; issueNumber: number; key: string; deleted: boolean }
  /** `previousName` when the label was renamed; GitHub reports it, Ghost does not. */
  | { kind: "label"; from: Side; name: string; deleted: boolean; previousName?: string }
  | { kind: "check_run"; from: Side; id: string }
  /** Every context's newest status on `sha` is copied at once, so repeated status events on one commit collapse into one waiting job. */
  | { kind: "status"; from: Side; sha: string }
  | { kind: "sync_check"; sha: string }
  /** Someone re-ran a check on Ghost: sync again, then copy whatever runs and statuses `sha` already has, since their events may have been missed. */
  | { kind: "rerun"; sha: string }
  | { kind: "reconcile" };
