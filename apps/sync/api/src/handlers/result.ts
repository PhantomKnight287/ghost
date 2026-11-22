import type { Side } from "../side.ts";
import type { SyncAction } from "../sync/action.ts";

/** What one webhook delivery asks for: a job on the sync of `repoId`, a change to an installation, or nothing. */
export type HandlerResult =
  | { kind: "job"; repoId: string; actor: string | null; action: SyncAction }
  | { kind: "installation"; side: Side; installationId: number; status?: "active" | "suspended" | "deleted"; added?: string[]; removed?: string[] }
  | null;
