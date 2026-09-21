import { createId } from "@paralleldrive/cuid2";
import {
  bigint,
  date,
  integer,
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
    lastPushedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // AnyPgColumn breaks the circular inference a self-reference would otherwise cause
    parentRepositoryId: text().references((): AnyPgColumn => repository.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
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
 * Denormalized "which commit last touched this path" for a single ref, so a directory listing costs one indexed query instead of one `git log` per entry.
 *
 * Keyed by path, with a row for every ancestor directory, so `src` carries the newest commit under `src/`. Deleted paths keep their row and are hidden by the join against `ls-tree`.
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
    committedAt: timestamp({ withTimezone: true }).notNull(),
    subject: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.repositoryId, t.ref, t.path] })],
);

/** How far `repository_path_commit` has been walked for a ref. A stored sha still reachable from the tip means the next walk covers only new commits; anything else forces a rebuild. */
export const repositoryRefIndex = pgTable(
  "repository_ref_index",
  {
    repositoryId: text()
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull(),
    ref: text().notNull(),
    indexedCommitSha: text().notNull(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.repositoryId, t.ref] })],
);

export const repositoryLanguageStat = pgTable(
  "repository_language_stat",
  {
    repositoryId: text()
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull(),
    ref: text().notNull(),
    language: text().notNull(),
    bytes: bigint({ mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.repositoryId, t.ref, t.language] })],
);

/** How far the language stats have been computed for a ref. A stored sha that is still an ancestor of the tip lets the next sync apply only the changed blobs; anything else forces a full `ls-tree` recount. */
export const repositoryLanguageIndex = pgTable(
  "repository_language_index",
  {
    repositoryId: text()
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull(),
    ref: text().notNull(),
    indexedCommitSha: text().notNull(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.repositoryId, t.ref] })],
);

/**
 * Daily commit counts per author on a repository's default branch, so the profile contribution graph costs one indexed query instead of materializing and walking every repository the user owns.
 *
 * One row per author email, lowercased. `authorId` is resolved at sync time and stays nullable, and readers match on both, so adding an email to an account never needs a reindex.
 */
export const repositoryContribution = pgTable(
  "repository_contribution",
  {
    repositoryId: text("repository_id")
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull(),
    authorEmail: text("author_email").notNull(),
    // UTC calendar day, YYYY-MM-DD.
    day: date("day").notNull(),
    // Name from the author's newest indexed commit.
    authorName: text("author_name").notNull(),
    // Linked account, if the author email matches one. Null for not-yet-registered authors; backfilled once they register.
    authorId: text("author_id").references(() => user.id, {
      onDelete: "set null",
    }),
    commits: integer("commits").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.repositoryId, t.authorEmail, t.day] })],
);

/** How far `repository_contribution` has been walked. One cursor per repository, since only the default branch is indexed; an unreachable sha forces a rebuild. */
export const repositoryContributionIndex = pgTable(
  "repository_contribution_index",
  {
    repositoryId: text("repository_id")
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull(),
    indexedCommitSha: text("indexed_commit_sha").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.repositoryId] })],
);
