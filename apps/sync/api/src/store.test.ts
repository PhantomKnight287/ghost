import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./db/schema.ts";
import { fakeStore } from "./lib/fake-store.ts";
import { createStore, type Store, type SyncRow } from "./store.ts";

const day = 24 * 60 * 60 * 1000;
type Subject = { store: Store; ageActivity(days: number): Promise<void>; ageDeliveries(days: number): Promise<void> };
type NewSync = Parameters<Store["createSync"]>[0];

const newSync = (overrides: Partial<NewSync> = {}): NewSync => ({
  ownerId: "user-1",
  ghostRepoId: "ghost-repo-uuid",
  ghostFullName: "acme/app",
  githubRepoId: "4242",
  githubFullName: "acme-gh/app",
  ghostInstallationId: 11,
  githubInstallationId: 22,
  ...overrides,
});

/** One contract, run against Postgres and the fake, so the fake the `sync/*` tests lean on cannot drift. */
function contract(make: () => Promise<Subject>) {
  let subject: Subject;
  let store: Store;
  let sync: SyncRow;
  beforeEach(async () => {
    subject = await make();
    store = subject.store;
    sync = await store.createSync(newSync());
  });

  test("a new sync starts backfilling, never reconciled", () => {
    expect(sync.status).toBe("backfilling");
    expect(sync.lastReconciledAt).toBeNull();
  });

  test("links are found by either side's id", async () => {
    await store.saveLink({ syncId: sync.id, kind: "comment", ghostId: "uuid-1", ghostRestId: "301", githubId: "9001" });
    expect(await store.findLink(sync.id, "comment", "ghost", "uuid-1")).toMatchObject({ githubId: "9001", ghostRestId: "301" });
    expect(await store.findLink(sync.id, "comment", "github", "9001")).toMatchObject({ ghostId: "uuid-1" });
    expect(await store.findLink(sync.id, "issue", "github", "9001")).toBeNull();
  });

  test("saving the same link again upserts", async () => {
    await store.saveLink({ syncId: sync.id, kind: "issue", ghostId: "12", ghostRestId: null, githubId: "5" });
    await store.saveLink({ syncId: sync.id, kind: "issue", ghostId: "12", ghostRestId: null, githubId: "6" });
    expect(await store.findLink(sync.id, "issue", "ghost", "12")).toMatchObject({ githubId: "6" });
    expect(await store.findLink(sync.id, "issue", "github", "5")).toBeNull();
  });

  test("deleteLink", async () => {
    await store.saveLink({ syncId: sync.id, kind: "issue", ghostId: "12", ghostRestId: null, githubId: "5" });
    await store.deleteLink(sync.id, "issue", "github", "5");
    expect(await store.findLink(sync.id, "issue", "ghost", "12")).toBeNull();
  });

  test("setBase records, flagRef flags, setBase clears the flag, setBase(null) removes", async () => {
    await store.setBase(sync.id, "refs/heads/main", "a");
    await store.flagRef(sync.id, "refs/heads/main", { ghost: "b", github: "c", reason: "diverged" });
    expect(await store.getRef(sync.id, "refs/heads/main")).toMatchObject({ baseSha: "a", diverged: { ghost: "b", github: "c", reason: "diverged" } });
    await store.setBase(sync.id, "refs/heads/main", "d");
    expect(await store.getRef(sync.id, "refs/heads/main")).toMatchObject({ baseSha: "d", diverged: null });
    await store.setBase(sync.id, "refs/heads/main", null);
    expect(await store.getRef(sync.id, "refs/heads/main")).toBeNull();
  });

  test("flagRef on a ref with no base keeps the base null", async () => {
    await store.flagRef(sync.id, "refs/heads/new", { ghost: "b", github: "c", reason: "diverged" });
    expect(await store.listRefs(sync.id)).toEqual([expect.objectContaining({ name: "refs/heads/new", baseSha: null })]);
  });

  test("claimDelivery is true only the first time, per side", async () => {
    expect(await store.claimDelivery("ghost", "d-1")).toBe(true);
    expect(await store.claimDelivery("ghost", "d-1")).toBe(false);
    expect(await store.claimDelivery("github", "d-1")).toBe(true);
  });

  test("findSyncByRepo on either side", async () => {
    expect((await store.findSyncByRepo("github", "4242"))?.id).toBe(sync.id);
    expect((await store.findSyncByRepo("ghost", "ghost-repo-uuid"))?.id).toBe(sync.id);
    expect(await store.findSyncByRepo("github", "1")).toBeNull();
  });

  test("listSyncs filters by status, owner and installation", async () => {
    const other = await store.createSync(newSync({ ownerId: "user-2", ghostRepoId: "g2", githubRepoId: "2", githubInstallationId: 33 }));
    await store.updateSync(other.id, { status: "paused" });
    expect((await store.listSyncs({ status: ["paused"] })).map((s) => s.id)).toEqual([other.id]);
    expect((await store.listSyncs({ ownerId: "user-1" })).map((s) => s.id)).toEqual([sync.id]);
    expect((await store.listSyncs({ installation: { side: "github", id: 33 } })).map((s) => s.id)).toEqual([other.id]);
  });

  test("updateSync", async () => {
    const at = new Date("2026-11-02T00:00:00Z");
    await store.updateSync(sync.id, { status: "disconnected", disconnectReason: "owner lost access", lastReconciledAt: at });
    expect(await store.getSync(sync.id)).toMatchObject({ status: "disconnected", disconnectReason: "owner lost access", lastReconciledAt: at });
  });

  test("activity is listed newest first, limited", async () => {
    for (const summary of ["one", "two", "three"]) await store.addActivity({ syncId: sync.id, direction: "github", kind: "issue", summary, error: null });
    expect((await store.listActivity(sync.id, 2)).map((a) => a.summary)).toEqual(["three", "two"]);
  });

  test("deleteSync removes its links, refs and activity", async () => {
    await store.saveLink({ syncId: sync.id, kind: "issue", ghostId: "12", ghostRestId: null, githubId: "5" });
    await store.setBase(sync.id, "refs/heads/main", "a");
    await store.addActivity({ syncId: sync.id, direction: null, kind: "refs", summary: "x", error: null });
    await store.deleteSync(sync.id);
    expect(await store.getSync(sync.id)).toBeNull();
    expect(await store.findLink(sync.id, "issue", "ghost", "12")).toBeNull();
    expect(await store.listRefs(sync.id)).toEqual([]);
    expect(await store.listActivity(sync.id, 10)).toEqual([]);
  });

  test("jobs on one sync are claimed oldest first, one at a time, with their action intact", async () => {
    await store.enqueueJob(sync.id, { kind: "issue", from: "github", number: 5, deleted: false });
    await store.enqueueJob(sync.id, { kind: "refs", refs: ["refs/heads/main"] });
    const first = await store.claimJob(60_000);
    expect(first).toMatchObject({ syncId: sync.id, action: { kind: "issue", from: "github", number: 5, deleted: false } });
    expect(await store.claimJob(60_000)).toBeNull();
    if (first) await store.finishJob(first);
    expect((await store.claimJob(60_000))?.action).toEqual({ kind: "refs", refs: ["refs/heads/main"] });
  });

  test("a job identical to one still waiting is not queued twice, but one behind a running job is", async () => {
    const action = { kind: "issue", from: "ghost", number: 12, deleted: false } as const;
    await store.enqueueJob(sync.id, action);
    await store.enqueueJob(sync.id, { deleted: false, number: 12, from: "ghost", kind: "issue" });
    const running = await store.claimJob(60_000);
    await store.enqueueJob(sync.id, action);
    if (running) await store.finishJob(running);
    expect((await store.claimJob(60_000))?.action).toEqual(action);
    expect(await store.claimJob(60_000)).toBeNull();
  });

  test("another sync's job is claimed while one runs", async () => {
    const other = await store.createSync(newSync({ ghostRepoId: "g2", githubRepoId: "2" }));
    await store.enqueueJob(sync.id, { kind: "reconcile" });
    await store.enqueueJob(sync.id, { kind: "refs", refs: ["refs/heads/main"] });
    await store.enqueueJob(other.id, { kind: "reconcile" });
    expect((await store.claimJob(60_000))?.syncId).toBe(sync.id);
    expect((await store.claimJob(60_000))?.syncId).toBe(other.id);
    expect(await store.claimJob(60_000)).toBeNull();
  });

  test("a lapsed lease is claimed again, and the old holder can neither extend nor finish it", async () => {
    await store.enqueueJob(sync.id, { kind: "reconcile" });
    const lapsed = await store.claimJob(1);
    await Bun.sleep(20);
    const current = await store.claimJob(60_000);
    expect(current?.id).toBe(lapsed?.id ?? -1);
    expect(current?.claimToken).not.toBe(lapsed?.claimToken);
    if (!lapsed || !current) throw new Error("unclaimed");
    await store.extendJob(lapsed, 1);
    await store.finishJob(lapsed);
    await Bun.sleep(20);
    expect(await store.claimJob(60_000)).toBeNull();
    await store.finishJob(current);
    expect(await store.claimJob(1)).toBeNull();
  });

  test("extendJob keeps a running job held", async () => {
    await store.enqueueJob(sync.id, { kind: "reconcile" });
    const held = await store.claimJob(30);
    if (!held) throw new Error("unclaimed");
    await store.extendJob(held, 60_000);
    await Bun.sleep(50);
    expect(await store.claimJob(60_000)).toBeNull();
  });

  test("deleteSync drops its queued jobs", async () => {
    await store.enqueueJob(sync.id, { kind: "reconcile" });
    await store.deleteSync(sync.id);
    expect(await store.claimJob(60_000)).toBeNull();
  });

  test("prune drops activity after 30 days and deliveries after 7", async () => {
    await store.addActivity({ syncId: sync.id, direction: null, kind: "refs", summary: "old", error: null });
    await store.claimDelivery("ghost", "old");
    await subject.ageActivity(31);
    await subject.ageDeliveries(8);
    await store.addActivity({ syncId: sync.id, direction: null, kind: "refs", summary: "new", error: null });
    await store.claimDelivery("ghost", "new");
    await store.prune(new Date());
    expect((await store.listActivity(sync.id, 10)).map((a) => a.summary)).toEqual(["new"]);
    expect(await store.claimDelivery("ghost", "old")).toBe(true);
    expect(await store.claimDelivery("ghost", "new")).toBe(false);
  });
}

describe("fake", () => {
  contract(async () => {
    const store = fakeStore();
    return {
      store,
      ageActivity: async (days) => {
        for (const a of store.activity) a.at = new Date(Date.now() - days * day);
      },
      ageDeliveries: async (days) => {
        for (const d of store.deliveries) d.receivedAt = new Date(Date.now() - days * day);
      },
    };
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("postgres", () => {
  const client = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const db = drizzle(client, { schema });
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: `${import.meta.dir}/../drizzle` });
  });
  contract(async () => {
    for (const table of [schema.job, schema.link, schema.ref, schema.activity, schema.delivery, schema.sync]) await db.delete(table);
    return {
      store: createStore(db),
      ageActivity: async (days) => {
        await db.update(schema.activity).set({ at: new Date(Date.now() - days * day) });
      },
      ageDeliveries: async (days) => {
        await db.update(schema.delivery).set({ receivedAt: new Date(Date.now() - days * day) });
      },
    };
  });

  test("workers claiming at once never take two jobs of one sync", async () => {
    const pool = postgres(url ?? "", { max: 6, onnotice: () => {} });
    const store = createStore(drizzle(pool, { schema }));
    const syncs = await Promise.all(["a", "b"].map((id) => store.createSync(newSync({ ghostRepoId: `race-${id}`, githubRepoId: `race-${id}` }))));
    for (const sync of syncs) for (let i = 0; i < 3; i++) await store.enqueueJob(sync.id, { kind: "refs", refs: [`refs/heads/b${i}`] });
    const claimed = (await Promise.all(Array.from({ length: 6 }, () => store.claimJob(60_000)))).filter((job) => job !== null);
    await pool.end();
    expect(claimed.map((job) => job.syncId).sort()).toEqual(syncs.map((sync) => sync.id).sort());
  });
});
