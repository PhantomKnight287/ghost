export type Queues = ReturnType<typeof createQueues>;

/** One serial queue per sync: jobs on a sync run in order, never overlapping; different syncs run side by side. */
export function createQueues(onError: (syncId: string, error: unknown) => void) {
  // ponytail: in-memory, one process; a Postgres job table when one instance is not enough
  const tails = new Map<string, Promise<void>>();

  return {
    push(syncId: string, job: () => Promise<void>) {
      const tail = (tails.get(syncId) ?? Promise.resolve()).then(job).catch((error: unknown) => onError(syncId, error));
      tails.set(syncId, tail);
      tail.then(() => {
        if (tails.get(syncId) === tail) tails.delete(syncId);
      });
    },
    /** Resolves once every queue is empty, including jobs queued by running jobs. */
    async idle() {
      while (tails.size > 0) await Promise.all(tails.values());
    },
  };
}
