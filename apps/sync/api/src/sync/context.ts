import type { GitOps, Remote } from "../git.ts";
import type { Rest } from "../rest.ts";
import type { Side } from "../side.ts";
import type { Store, SyncRow } from "../store.ts";

export type SyncContext = {
  sync: SyncRow;
  rest: Record<Side, Rest>;
  /** REST paths are `/repos/${owner}/${name}/...`. */
  repo: Record<Side, { owner: string; name: string }>;
  /** Fresh installation tokens on every call. */
  remote: () => Promise<Record<Side, Remote>>;
  git: GitOps;
  /** `${SYNC_DATA_DIR}/${sync.id}.git` */
  dir: string;
  /** `${slug}[bot]`, the login our own writes come back as. */
  bot: Record<Side, string>;
  appSlug: Record<Side, string>;
  /** A client writing to `to` as the person whose account on `from` has id `authorId`, when they linked both sides; null sends the write through the app. */
  authorRest: (from: Side, authorId: number, to: Side) => Promise<Rest | null>;
  store: Store;
};

/** `/repos/<owner>/<name>` of the sync's repository on `side`, the prefix of every REST path. */
export const repoPath = (ctx: SyncContext, side: Side) => `/repos/${ctx.repo[side].owner}/${ctx.repo[side].name}`;
