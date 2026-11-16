import { RestError } from "../rest.ts";
import type { Side } from "../side.ts";
import type { SyncContext } from "./context.ts";

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

/** Records an item that could not be copied to `to`, without failing the job. */
export async function skipped(ctx: SyncContext, to: Side, kind: string, summary: string, error: unknown) {
  await ctx.store.addActivity({ syncId: ctx.sync.id, direction: to, kind, summary, error: error instanceof Error ? error.message : String(error) });
}
