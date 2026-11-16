import type { Side } from "../side.ts";
import type { ActivityRow, Link, RefRow, Store, SyncRow } from "../store.ts";
import type { SyncAction } from "../sync/action.ts";

type FakeJob = { id: number; syncId: string; action: SyncAction; claimToken: string | null; lockedUntil: number | null };

export type FakeStore = Store & {
  links: Link[];
  refs: RefRow[];
  syncs: SyncRow[];
  activity: ActivityRow[];
  deliveries: { side: Side; deliveryId: string; receivedAt: Date }[];
  jobs: FakeJob[];
};

const idOf = (link: Link, side: Side) => (side === "ghost" ? link.ghostId : link.githubId);

/** The `Store` in memory, for the `sync/*`, pipeline and route tests. `store.test.ts` runs the same assertions against it and the Postgres store. */
export function fakeStore(seed: { syncs?: SyncRow[] } = {}): FakeStore {
  let jobIds = 0;
  const store: FakeStore = {
    links: [],
    refs: [],
    syncs: [...(seed.syncs ?? [])],
    activity: [],
    deliveries: [],
    jobs: [],
    async findLink(syncId, kind, side, id) {
      return store.links.find((l) => l.syncId === syncId && l.kind === kind && idOf(l, side) === id) ?? null;
    },
    async saveLink(link) {
      store.links = store.links.filter((l) => !(l.syncId === link.syncId && l.kind === link.kind && (l.ghostId === link.ghostId || l.githubId === link.githubId)));
      store.links.push({ ...link, updatedAt: new Date() });
    },
    async deleteLink(syncId, kind, side, id) {
      store.links = store.links.filter((l) => !(l.syncId === syncId && l.kind === kind && idOf(l, side) === id));
    },
    async getRef(syncId, name) {
      return store.refs.find((r) => r.syncId === syncId && r.name === name) ?? null;
    },
    async listRefs(syncId) {
      return store.refs.filter((r) => r.syncId === syncId);
    },
    async setBase(syncId, name, sha) {
      store.refs = store.refs.filter((r) => !(r.syncId === syncId && r.name === name));
      if (sha !== null) store.refs.push({ syncId, name, baseSha: sha, diverged: null });
    },
    async flagRef(syncId, name, diverged) {
      const existing = await store.getRef(syncId, name);
      if (existing) existing.diverged = diverged;
      else store.refs.push({ syncId, name, baseSha: null, diverged });
    },
    async claimDelivery(side, deliveryId) {
      if (store.deliveries.some((d) => d.side === side && d.deliveryId === deliveryId)) return false;
      store.deliveries.push({ side, deliveryId, receivedAt: new Date() });
      return true;
    },
    async addActivity(entry) {
      store.activity.push({ ...entry, at: new Date() });
    },
    async listActivity(syncId, limit) {
      return store.activity.filter((a) => a.syncId === syncId).slice(-limit).reverse();
    },
    async getSync(id) {
      return store.syncs.find((s) => s.id === id) ?? null;
    },
    async findSyncByRepo(side, repoId) {
      return store.syncs.find((s) => (side === "ghost" ? s.ghostRepoId : s.githubRepoId) === repoId) ?? null;
    },
    async listSyncs(filter) {
      return store.syncs.filter(
        (s) =>
          (!filter.status || filter.status.includes(s.status)) &&
          (!filter.ownerId || s.ownerId === filter.ownerId) &&
          (!filter.installation || (filter.installation.side === "ghost" ? s.ghostInstallationId : s.githubInstallationId) === filter.installation.id),
      );
    },
    async createSync(input) {
      const now = new Date();
      const row: SyncRow = { ...input, id: crypto.randomUUID(), status: "backfilling", lastError: null, disconnectReason: null, lastReconciledAt: null, createdAt: now, updatedAt: now };
      store.syncs.push(row);
      return row;
    },
    async updateSync(id, patch) {
      const sync = store.syncs.find((s) => s.id === id);
      if (sync) Object.assign(sync, patch, { updatedAt: new Date() });
    },
    async deleteSync(id) {
      store.syncs = store.syncs.filter((s) => s.id !== id);
      store.links = store.links.filter((l) => l.syncId !== id);
      store.refs = store.refs.filter((r) => r.syncId !== id);
      store.activity = store.activity.filter((a) => a.syncId !== id);
      store.jobs = store.jobs.filter((j) => j.syncId !== id);
    },
    async prune(now) {
      const day = 24 * 60 * 60 * 1000;
      store.activity = store.activity.filter((a) => now.getTime() - a.at.getTime() <= 30 * day);
      store.deliveries = store.deliveries.filter((d) => now.getTime() - d.receivedAt.getTime() <= 7 * day);
    },
    async enqueueJob(syncId, action) {
      if (store.jobs.some((j) => j.syncId === syncId && j.claimToken === null && Bun.deepEquals(j.action, action))) return;
      store.jobs.push({ id: ++jobIds, syncId, action: structuredClone(action), claimToken: null, lockedUntil: null });
    },
    async claimJob(leaseMs) {
      const now = Date.now();
      const free = store.jobs.find((j) => (j.lockedUntil === null || j.lockedUntil < now) && !store.jobs.some((o) => o.syncId === j.syncId && o.id < j.id));
      if (!free) return null;
      free.claimToken = crypto.randomUUID();
      free.lockedUntil = now + leaseMs;
      return { id: free.id, syncId: free.syncId, action: structuredClone(free.action), claimToken: free.claimToken };
    },
    async extendJob(held, leaseMs) {
      const found = store.jobs.find((j) => j.id === held.id && j.claimToken === held.claimToken);
      if (found) found.lockedUntil = Date.now() + leaseMs;
    },
    async finishJob(held) {
      store.jobs = store.jobs.filter((j) => !(j.id === held.id && j.claimToken === held.claimToken));
    },
  };
  return store;
}
