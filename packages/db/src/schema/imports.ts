import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { repository } from "./repository.js";

/** Seeded by migration 0038. Its username has a hyphen, which Better Auth's username validator refuses, so no person can ever register it. */
export const IMPORTER_USER_ID = "user_ghost_importer";

export const repositoryImportStatus = pgEnum("repository_import_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
]);

/**
 * One GitHub import per repository, driven by the API and run by `apps/importer`.
 *
 * `claimToken` changes on every attempt and every importer callback must carry it, so an attempt the API gave up on cannot write after its retry started. `leaseUntil` is pushed forward by each callback; a running row past it is an importer that went silent.
 */
export const repositoryImport = pgTable(
  "repository_import",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => `import_${createId()}`),
    repositoryId: text()
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull()
      .unique(),
    requestedById: text()
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
    // `owner/name` on github.com.
    source: text().notNull(),
    status: repositoryImportStatus().notNull().default("pending"),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp({ withTimezone: true }).notNull().defaultNow(),
    claimToken: uuid().notNull().defaultRandom(),
    // The push key minted for the current attempt, deleted when the attempt ends.
    apiKeyId: text(),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index("repository_import_active_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.status} in ('pending', 'running')`),
  ],
);
