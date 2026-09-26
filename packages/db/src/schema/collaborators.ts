import { createId } from "@paralleldrive/cuid2";
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth.js";
import { repository } from "./repository.js";

/** Lowest to highest. The owner is not a role here: ownership lives on `repository.ownerId`. */
export const repositoryRole = pgEnum("repository_role", [
  "read",
  "triage",
  "write",
  "maintain",
  "admin",
]);

/** An invitation until `acceptedAt` is set, and only then a grant: a pending row gives its user nothing. */
export const repositoryCollaborator = pgTable(
  "repository_collaborator",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => `collab_${createId()}`),
    repositoryId: text()
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull(),
    userId: text()
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
    role: repositoryRole().notNull(),
    invitedById: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("repository_collaborator_repository_user_idx").on(
      t.repositoryId,
      t.userId,
    ),
    index("repository_collaborator_user_idx").on(t.userId),
  ],
);
