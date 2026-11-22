import type { ClaimedJob, Store } from "./store.ts";
import type { SyncAction } from "./sync/action.ts";

export type Queue = ReturnType<typeof createQueue>;

/**
 * Jobs live in Postgres, so a restart or a second instance loses nothing. Jobs on one sync run in order, one at a time, across every instance; different syncs run side by side.
 * A failed job is reported and dropped: the next reconcile brings that item into agreement anyway.
 */
export function createQueue({
  store,
  run,
  onError,
  concurrency = 4,
  leaseMs = 60_000,
  pollMs = 1_000,
}: {
  store: Store;
  run: (syncId: string, action: SyncAction) => Promise<void>;
  /** `syncId` is null when the queue itself failed, such as the database being unreachable. */
  onError: (syncId: string | null, error: unknown) => void;
  concurrency?: number;
  leaseMs?: number;
  pollMs?: number;
}) {
  const running = new Set<Promise<void>>();
  let filling = Promise.resolve();
  let timer: ReturnType<typeof setInterval> | null = null;

  const execute = async (held: ClaimedJob) => {
    // The lease outlives a crashed worker by at most `leaseMs`; renewing it keeps a long job (a first backfill) from being claimed twice.
    const heartbeat = setInterval(() => store.extendJob(held, leaseMs).catch((error) => onError(held.syncId, error)), leaseMs / 3);
    try {
      await run(held.syncId, held.action);
    } catch (error) {
      onError(held.syncId, error);
    } finally {
      clearInterval(heartbeat);
      await store.finishJob(held).catch((error) => onError(held.syncId, error));
    }
  };

  // Chained, so callers filling at once never claim past `concurrency`.
  const fill = () => {
    filling = filling
      .then(async () => {
        while (running.size < concurrency) {
          const held = await store.claimJob(leaseMs);
          if (!held) return;
          const task = execute(held).finally(() => {
            running.delete(task);
            if (timer) fill();
          });
          running.add(task);
        }
      })
      .catch((error) => onError(null, error));
    return filling;
  };

  return {
    /** Resolves once the job is stored, so a webhook acknowledged after it is never lost. */
    async push(syncId: string, action: SyncAction) {
      await store.enqueueJob(syncId, action);
      if (timer) fill();
    },
    start() {
      timer ??= setInterval(fill, pollMs);
      fill();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      await filling;
      await Promise.all(running);
    },
    /** Runs jobs until none is left or claimable, including jobs queued by running jobs. */
    async idle() {
      for (;;) {
        await fill();
        if (running.size === 0) return;
        await Promise.race(running);
      }
    },
  };
}
