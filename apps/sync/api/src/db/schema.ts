import { bigint, bigserial, boolean, index, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { Side } from "../side.ts";
import type { SyncAction } from "../sync/action.ts";

export type SyncStatus = "backfilling" | "active" | "paused" | "disconnected" | "error";
export type LinkKind = "issue" | "pull" | "comment" | "review" | "review_comment" | "label" | "check_run";
type SyncedValue = string | boolean | string[] | null;
/** An item's fields as both sides last agreed on them, so a later pass can tell which side changed since. A field is either its agreed value or the two values paired twins agreed to keep apart until either side changes. */
export type SyncedFields = Record<string, SyncedValue | { differ: SyncedValue[] }>;
/** Each side's refs (name to sha) when a sync started without its history. */
export type RefsAtSetup = Record<Side, Record<string, string>>;
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
  /** False when the owner chose to sync only what happens from now on: nothing from before the sync started is copied. */
  backfill: boolean("backfill").notNull().default(true),
  /** Set by the first run of a sync without backfill; a ref still where it was then is history, left alone until someone moves it. */
  refsAtSetup: jsonb("refs_at_setup").$type<RefsAtSetup>(),
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
    synced: jsonb("synced").$type<SyncedFields>(),
    /** When twins a person kept by hand were paired; each keeps its own comments and reviews from before. */
    pairedAt: timestamp("paired_at", { withTimezone: true }),
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

// better-auth's tables, in the shape its drizzle adapter expects. Users sign in with Ghost and link GitHub; there are no passwords.
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index().on(table.userId)],
);

/** Tokens are stored encrypted (`account.encryptOAuthTokens`). */
export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index().on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index().on(table.identifier)],
);
