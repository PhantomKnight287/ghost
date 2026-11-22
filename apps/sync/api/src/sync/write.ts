import { RestError } from "../rest.ts";
import { readMarker } from "../format.ts";
import { SIDE_NAME, type Side } from "../side.ts";
import type { Link, LinkKind } from "../store.ts";
import { isNewer, mergeFields } from "./fields.ts";
import type { SyncContext } from "./context.ts";

type Edited = { body: string | null; updated_at?: string };

export const isNotFound = (error: unknown) => error instanceof RestError && error.status === 404;

/** A 5xx or a dropped connection: the host may have created the item before failing to answer. */
const mayHaveLanded = (error: unknown) => !(error instanceof RestError) || error.status >= 500;

/**
 * POSTs a new item once. When the answer is lost after the host may have created it, `findCreated` looks for our copy before giving up, so a retry or the next reconcile does not create it twice.
 */
export async function createOnce<T>(ctx: SyncContext, side: Side, path: string, payload: unknown, findCreated: () => Promise<T | undefined>): Promise<T> {
  try {
    return await ctx.rest[side].request<T>("POST", path, payload);
  } catch (error) {
    if (!mayHaveLanded(error)) throw error;
    const found = await findCreated();
    if (found === undefined) throw error;
    return found;
  }
}

/** Records a write that reached `to`; callers record only writes that changed something, so the log never fills with no-op reconciles. */
export async function done(ctx: SyncContext, to: Side, kind: string, summary: string) {
  await ctx.store.addActivity({ syncId: ctx.sync.id, direction: to, kind, summary, error: null });
}

/** Copies an edit of a linked comment's body onto its copy at `path`, unless the copy was edited since they last agreed. `what` names the comment in the log. */
export async function followBody(ctx: SyncContext, to: Side, kind: LinkKind, link: Link, path: string, source: Edited, body: string, what: string) {
  let target: Edited;
  try {
    target = await ctx.rest[to].request<Edited>("GET", path);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await skipped(ctx, to, kind, `The ${SIDE_NAME[to]} copy of ${what} is gone`, error);
    return;
  }
  const { write, agreed } = mergeFields({ body: readMarker(source.body ?? "").body }, { body: readMarker(target.body ?? "").body }, link.synced, isNewer(source, target));
  if ("body" in write) {
    await ctx.rest[to].request("PATCH", path, { body });
    await done(ctx, to, kind, `Edited the copy of ${what}`);
  }
  await ctx.store.saveLink({ ...link, synced: agreed });
}

/** Records an item that could not be copied to `to`, without failing the job. */
export async function skipped(ctx: SyncContext, to: Side, kind: string, summary: string, error: unknown) {
  await ctx.store.addActivity({ syncId: ctx.sync.id, direction: to, kind, summary, error: error instanceof Error ? error.message : String(error) });
}
