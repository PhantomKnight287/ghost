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
  store: Store;
};
