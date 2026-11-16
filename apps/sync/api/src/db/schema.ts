import { bigint, bigserial, index, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { Side } from "../side.ts";
import type { SyncAction } from "../sync/action.ts";

export type SyncStatus = "backfilling" | "active" | "paused" | "disconnected" | "error";
export type LinkKind = "issue" | "pull" | "comment" | "review" | "review_comment" | "label" | "check_run";
/** `notified` is false until every linked pull request has been told; `posted` lists the `<side>#<number>` comments already made, so a retry only posts the missing ones. */
export type RefFlag = { ghost: string | null; github: string | null; reason: string; notified?: boolean; posted?: string[] };

export const sync = pgTable("sync", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull(),
  ghostRepoId: text("ghost_repo_id").notNull().unique(),
  ghostFullName: text("ghost_full_name").notNull(),
  githubRepoId: text("github_repo_id").notNull().unique(),
  githubFullName: text("github_full_name").notNull(),
  ghostInstallationId: bigint("ghost_installation_id", { mode: "number" }),
  githubInstallationId: bigint("github_installation_id", { mode: "number" }),
  status: text("status").$type<SyncStatus>().notNull().default("backfilling"),
  lastError: text("last_error"),
  disconnectReason: text("disconnect_reason"),
  lastReconciledAt: timestamp("last_reconciled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const link = pgTable(
  "link",
  {
    syncId: uuid("sync_id")
      .notNull()
      .references(() => sync.id, { onDelete: "cascade" }),
    kind: text("kind").$type<LinkKind>().notNull(),
    ghostId: text("ghost_id").notNull(),
    ghostRestId: text("ghost_rest_id"),
    githubId: text("github_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.syncId, table.kind, table.ghostId] }), unique().on(table.syncId, table.kind, table.githubId)],
);

export const ref = pgTable(
  "ref",
  {
    syncId: uuid("sync_id")
      .notNull()
      .references(() => sync.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    baseSha: text("base_sha"),
    diverged: jsonb("diverged").$type<RefFlag>(),
  },
  (table) => [primaryKey({ columns: [table.syncId, table.name] })],
);

export const delivery = pgTable(
  "delivery",
  {
    side: text("side").$type<Side>().notNull(),
    deliveryId: text("delivery_id").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.side, table.deliveryId] })],
);

export const job = pgTable(
  "job",
  {
    // Also the order jobs on one sync run in.
    id: bigserial("id", { mode: "number" }).primaryKey(),
    syncId: uuid("sync_id")
      .notNull()
      .references(() => sync.id, { onDelete: "cascade" }),
    action: jsonb("action").$type<SyncAction>().notNull(),
    claimToken: uuid("claim_token"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index().on(table.syncId, table.id)],
);

export const activity = pgTable(
  "activity",
  {
    // Orders rows written within the same timestamp.
    id: bigserial("id", { mode: "number" }).primaryKey(),
    syncId: uuid("sync_id")
      .notNull()
      .references(() => sync.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    direction: text("direction").$type<Side>(),
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    error: text("error"),
  },
  (table) => [index().on(table.syncId, table.at)],
);
