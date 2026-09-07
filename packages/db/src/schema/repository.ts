import { createId } from "@paralleldrive/cuid2";
import {
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth.js";
import { isNotNull, isNull } from "drizzle-orm";

export const repositoryVisiblity = pgEnum("repository_visibility", [
  "public",
  "private",
]);

export const repository = pgTable(
  "repository",
  {
    id: text()
      .primaryKey()
      .unique()
      .notNull()
      .$defaultFn(() => `repo_${createId()}`),
    name: text().notNull(),
    slug: text().notNull(),
    description: text(),
    // nullable cus a repo can also belong to just a user
    organizationId: text().references(() => organization.id, {
      onDelete: "cascade",
    }),
    // a repo will always have an owner. will also allow them to transfer the ownership incase they wanna preserve the repo but delete the account
    ownerId: text()
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),

    visibility: repositoryVisiblity().notNull().default("private"),
    lastPushedAt: timestamp().notNull().defaultNow(),
    // AnyPgColumn breaks the circular inference a self-reference would otherwise cause
    parentRepositoryId: text().references((): AnyPgColumn => repository.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("repository_org_slug_idx")
      .on(t.organizationId, t.slug)
      .where(isNotNull(t.organizationId)),

    uniqueIndex("repository_owner_slug_idx")
      .on(t.ownerId, t.slug)
      .where(isNull(t.organizationId)),
  ],
);

/**
 * Denormalized "which commit last touched this path" for a single ref, so a
 * directory listing costs one indexed query instead of one `git log` per entry.
 *
 * Rows are keyed by path, and every ancestor directory of a changed file gets a
 * row too, so `src` carries the newest commit under `src/`. Paths deleted from
 * the tree keep their row; the read path joins against `ls-tree`, so they are
 * invisible until something prunes them.
 */
export const repositoryPathCommit = pgTable(
  "repository_path_commit",
  {
    repositoryId: text()
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull(),
    ref: text().notNull(),
    // "" is the repository root, so its row is the tip commit of the ref
    path: text().notNull(),
    commitSha: text().notNull(),
    committedAt: timestamp().notNull(),
    subject: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.repositoryId, t.ref, t.path] })],
);

/**
 * How far `repository_path_commit` has been walked for a ref. A stored sha that
 * is still an ancestor of the tip means the next walk only has to cover the new
 * commits; anything else (force push, dropped objects) forces a full rebuild.
 */
export const repositoryRefIndex = pgTable(
  "repository_ref_index",
  {
    repositoryId: text()
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull(),
    ref: text().notNull(),
    indexedCommitSha: text().notNull(),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.repositoryId, t.ref] })],
);
