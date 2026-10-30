import { createId } from "@paralleldrive/cuid2";
import {
  bigint,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { app, appInstallation } from "./apps.js";
import { user } from "./auth.js";
import { repository } from "./repository.js";

export const commitStatusState = pgEnum("commit_status_state", [
  "pending",
  "success",
  "failure",
  "error",
]);

/** A result an external system reported on a commit. Append-only: each report is a new row, and the newest per context is the current one. */
export const commitStatus = pgTable(
  "commit_status",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => `cst_${createId()}`),
    // Integer id for the GitHub compatibility layer only (REST `id`, GraphQL `databaseId`); nothing references it and Ghost's own API does not expose it.
    numericId: bigint({ mode: "number" })
      .generatedAlwaysAsIdentity()
      .notNull()
      .unique(),
    repositoryId: text()
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull(),
    sha: text().notNull(),
    state: commitStatusState().notNull(),
    context: text().notNull().default("default"),
    description: text(),
    targetUrl: text(),
    creatorId: text().references(() => user.id, { onDelete: "set null" }),
    // Set when an installation token posted it; what a ruleset's `integration_id` checks.
    // The app a user-to-server token acted through; the author is still the user.
    viaAppId: text().references(() => app.id, { onDelete: "set null" }),
    installationId: text().references(() => appInstallation.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("commit_status_lookup_idx").on(
      t.repositoryId,
      t.sha,
      t.context,
      t.createdAt.desc(),
    ),
  ],
);
