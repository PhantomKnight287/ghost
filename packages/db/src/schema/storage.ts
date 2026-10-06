import { createId } from "@paralleldrive/cuid2";
import {
  bigint,
  check,
  primaryKey,
  uniqueIndex,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { organization, user } from "./auth.js";
import { repository } from "./repository.js";

/** Per-account overrides of the instance's storage limits. A null limit falls back to the environment's. */
export const storageLimit = pgTable(
  "storage_limit",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => `limit_${createId()}`),
    userId: text()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text()
      .unique()
      .references(() => organization.id, { onDelete: "cascade" }),
    repositoryBytes: bigint({ mode: "number" }),
    forkBytes: bigint({ mode: "number" }),
    lfsBytes: bigint({ mode: "number" }),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  () => [
    check(
      "storage_limit_owner",
      sql`num_nonnulls(user_id, organization_id) = 1`,
    ),
  ],
);

/** Bytes a repository's log holds that its account is billed for, one row per WAL entry. A fork has rows for the entries it copied from its parent, under the same ulids. */
export const repositoryLogEntry = pgTable(
  "repository_log_entry",
  {
    repositoryId: text()
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull(),
    ulid: text().notNull(),
    size: bigint({ mode: "number" }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.repositoryId, t.ulid] })],
);

/** A Git LFS object a repository holds, stored at `lfs/<repositoryId>/<oid>`. A null `uploadedAt` is a reservation for an upload still in flight. */
export const lfsObject = pgTable(
  "lfs_object",
  {
    repositoryId: text()
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull(),
    oid: text().notNull(),
    size: bigint({ mode: "number" }).notNull(),
    uploadedAt: timestamp({ withTimezone: true }),
    // Which upload holds the reservation, so one whose reservation lapsed and was taken cannot clean up after its successor. Null for rows a fork or merge copied.
    uploadId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.repositoryId, t.oid] })],
);

/** A Git LFS lock: one person's claim on a path, which git-lfs checks before it pushes. */
export const lfsLock = pgTable(
  "lfs_lock",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => `lock_${createId()}`),
    repositoryId: text()
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull(),
    path: text().notNull(),
    ownerId: text()
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("lfs_lock_repository_path_idx").on(t.repositoryId, t.path)],
);
