import { and, count, desc, eq, inArray, isNull, lt, notExists, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./db/schema.ts";
import type { LinkKind, RefFlag, SyncedFields } from "./db/schema.ts";
import type { Side } from "./side.ts";
import type { SyncAction } from "./sync/action.ts";

export type { LinkKind, RefFlag, SyncedFields, SyncStatus } from "./db/schema.ts";
export type SyncRow = typeof schema.sync.$inferSelect;
export type Link = typeof schema.link.$inferSelect;
export type RefRow = typeof schema.ref.$inferSelect;
export type ActivityRow = Omit<typeof schema.activity.$inferSelect, "id">;
/** A job held by one worker; `claimToken` proves the hold, so a worker whose lease lapsed cannot finish a job someone else now runs. */
export type ClaimedJob = { id: number; syncId: string; action: SyncAction; claimToken: string };

export type Store = {
  findLink(syncId: string, kind: LinkKind, side: Side, id: string): Promise<Link | null>;
  /** `synced` is what both sides agree on right after the write; left out, nothing is known yet. */
  saveLink(link: Omit<Link, "updatedAt" | "synced" | "pairedAt"> & { synced?: SyncedFields | null; pairedAt?: Date | null }): Promise<void>;
  deleteLink(syncId: string, kind: LinkKind, side: Side, id: string): Promise<void>;
  /** How many items of each kind are paired; kinds with none are left out. */
  countLinks(syncId: string): Promise<Partial<Record<LinkKind, number>>>;
  getRef(syncId: string, name: string): Promise<RefRow | null>;
  listRefs(syncId: string): Promise<RefRow[]>;
  /** null deletes the row; always clears `diverged`. */
  setBase(syncId: string, name: string, sha: string | null): Promise<void>;
  flagRef(syncId: string, name: string, diverged: RefFlag): Promise<void>;
  /** true the first time a side's delivery id is seen. */
  claimDelivery(side: Side, deliveryId: string): Promise<boolean>;
  /** Forgets a claimed delivery whose handling failed, so the host's retry is processed rather than dropped as a duplicate. */
  releaseDelivery(side: Side, deliveryId: string): Promise<void>;
  addActivity(entry: Omit<ActivityRow, "at">): Promise<void>;
  listActivity(syncId: string, limit: number): Promise<ActivityRow[]>;
  getSync(id: string): Promise<SyncRow | null>;
  findSyncByRepo(side: Side, repoId: string): Promise<SyncRow | null>;
  listSyncs(filter: { status?: SyncRow["status"][]; ownerId?: string; installation?: { side: Side; id: number } }): Promise<SyncRow[]>;
  createSync(input: Pick<SyncRow, "ownerId" | "ghostRepoId" | "ghostFullName" | "githubRepoId" | "githubFullName" | "ghostInstallationId" | "githubInstallationId"> & { backfill?: boolean }): Promise<SyncRow>;
  updateSync(id: string, patch: Partial<Pick<SyncRow, "status" | "lastError" | "disconnectReason" | "lastReconciledAt" | "ghostInstallationId" | "githubInstallationId" | "refsAtSetup">>): Promise<void>;
  /** Removes the sync with its links, refs and activity. */
  deleteSync(id: string): Promise<void>;
  prune(now: Date): Promise<void>;
  /** Skips the job when an identical one is still waiting: every action reads current state when it runs, so one run covers both. */
  enqueueJob(syncId: string, action: SyncAction): Promise<void>;
  /** The oldest job of a sync with nothing older queued or running, held for `leaseMs`; null when none is free. */
  claimJob(leaseMs: number): Promise<ClaimedJob | null>;
  extendJob(job: ClaimedJob, leaseMs: number): Promise<void>;
  finishJob(job: ClaimedJob): Promise<void>;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const { activity, delivery, job, link, ref, sync } = schema;
const older = alias(job, "older");
const leaseEnd = (leaseMs: number) => sql`now() + ${leaseMs} * interval '1 millisecond'`;

export function createStore(db: PostgresJsDatabase<typeof schema>): Store {
  const linkOf = (syncId: string, kind: LinkKind, side: Side, id: string) =>
    and(eq(link.syncId, syncId), eq(link.kind, kind), eq(side === "ghost" ? link.ghostId : link.githubId, id));
  const refOf = (syncId: string, name: string) => and(eq(ref.syncId, syncId), eq(ref.name, name));

  return {
    async findLink(syncId, kind, side, id) {
      const [row] = await db.select().from(link).where(linkOf(syncId, kind, side, id));
      return row ?? null;
    },
    async saveLink(next) {
      // Either side's id may already belong to another pairing; the new pairing replaces both.
      await db.transaction(async (tx) => {
        await tx
          .delete(link)
          .where(and(eq(link.syncId, next.syncId), eq(link.kind, next.kind), or(eq(link.ghostId, next.ghostId), eq(link.githubId, next.githubId))));
        await tx.insert(link).values({ ...next, synced: next.synced ?? null, pairedAt: next.pairedAt ?? null });
      });
    },
    async deleteLink(syncId, kind, side, id) {
      await db.delete(link).where(linkOf(syncId, kind, side, id));
    },
    async countLinks(syncId) {
      const rows = await db.select({ kind: link.kind, count: count() }).from(link).where(eq(link.syncId, syncId)).groupBy(link.kind);
      return Object.fromEntries(rows.map((row) => [row.kind, row.count]));
    },
    async getRef(syncId, name) {
      const [row] = await db.select().from(ref).where(refOf(syncId, name));
      return row ?? null;
    },
    listRefs: (syncId) => db.select().from(ref).where(eq(ref.syncId, syncId)),
    async setBase(syncId, name, sha) {
      if (sha === null) {
        await db.delete(ref).where(refOf(syncId, name));
        return;
      }
      await db
        .insert(ref)
        .values({ syncId, name, baseSha: sha, diverged: null })
        .onConflictDoUpdate({ target: [ref.syncId, ref.name], set: { baseSha: sha, diverged: null } });
    },
    async flagRef(syncId, name, diverged) {
      await db.insert(ref).values({ syncId, name, diverged }).onConflictDoUpdate({ target: [ref.syncId, ref.name], set: { diverged } });
    },
    async claimDelivery(side, deliveryId) {
      const inserted = await db.insert(delivery).values({ side, deliveryId }).onConflictDoNothing().returning({ deliveryId: delivery.deliveryId });
      return inserted.length > 0;
    },
    async releaseDelivery(side, deliveryId) {
      await db.delete(delivery).where(and(eq(delivery.side, side), eq(delivery.deliveryId, deliveryId)));
    },
    async addActivity(entry) {
      await db.insert(activity).values(entry);
    },
    listActivity: (syncId, limit) =>
      db
        .select({ syncId: activity.syncId, at: activity.at, direction: activity.direction, kind: activity.kind, summary: activity.summary, error: activity.error })
        .from(activity)
        .where(eq(activity.syncId, syncId))
        .orderBy(desc(activity.at), desc(activity.id))
        .limit(limit),
    async getSync(id) {
      const [row] = await db.select().from(sync).where(eq(sync.id, id));
      return row ?? null;
    },
    async findSyncByRepo(side, repoId) {
      const [row] = await db
        .select()
        .from(sync)
        .where(eq(side === "ghost" ? sync.ghostRepoId : sync.githubRepoId, repoId));
      return row ?? null;
    },
    listSyncs(filter) {
      const conditions: SQL[] = [];
      if (filter.status) conditions.push(inArray(sync.status, filter.status));
      if (filter.ownerId) conditions.push(eq(sync.ownerId, filter.ownerId));
      if (filter.installation)
        conditions.push(eq(filter.installation.side === "ghost" ? sync.ghostInstallationId : sync.githubInstallationId, filter.installation.id));
      return db
        .select()
        .from(sync)
        .where(and(...conditions))
        .orderBy(sync.createdAt);
    },
    async createSync(input) {
      const [row] = await db.insert(sync).values(input).returning();
      if (!row) throw new Error(`Saving the sync of ${input.ghostFullName} with ${input.githubFullName} returned no row`);
      return row;
    },
    async updateSync(id, patch) {
      await db
        .update(sync)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(sync.id, id));
    },
    async deleteSync(id) {
      await db.delete(sync).where(eq(sync.id, id));
    },
    async prune(now) {
      await db.delete(activity).where(lt(activity.at, new Date(now.getTime() - 30 * DAY_MS)));
      await db.delete(delivery).where(lt(delivery.receivedAt, new Date(now.getTime() - 7 * DAY_MS)));
    },
    async enqueueJob(syncId, action) {
      const json = JSON.stringify(action);
      await db.execute(
        sql`insert into ${job} (sync_id, action) select ${syncId}, ${json}::jsonb where not exists (select 1 from ${job} where sync_id = ${syncId} and action = ${json}::jsonb and claim_token is null)`,
      );
    },
    async claimJob(leaseMs) {
      const free = db
        .select({ id: job.id })
        .from(job)
        .where(
          and(
            or(isNull(job.lockedUntil), lt(job.lockedUntil, sql`now()`)),
            notExists(db.select({ id: older.id }).from(older).where(and(eq(older.syncId, job.syncId), lt(older.id, job.id)))),
          ),
        )
        .orderBy(job.id)
        .limit(1)
        .for("update", { skipLocked: true });
      const claimToken = crypto.randomUUID();
      const [claimed] = await db
        .update(job)
        .set({ claimToken, lockedUntil: leaseEnd(leaseMs) })
        .where(inArray(job.id, free))
        .returning({ id: job.id, syncId: job.syncId, action: job.action });
      return claimed ? { ...claimed, claimToken } : null;
    },
    async extendJob(held, leaseMs) {
      await db
        .update(job)
        .set({ lockedUntil: leaseEnd(leaseMs) })
        .where(and(eq(job.id, held.id), eq(job.claimToken, held.claimToken)));
    },
    async finishJob(held) {
      await db.delete(job).where(and(eq(job.id, held.id), eq(job.claimToken, held.claimToken)));
    },
  };
}
