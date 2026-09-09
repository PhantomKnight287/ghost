import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { repository } from "./repository.js";

export const pullRequestState = pgEnum("pull_request_state", [
  "open",
  "closed",
  "merged",
]);

/**
 * Base and head are stored as separate repository ids because they are only the
 * same row for a branch-to-branch request; a fork request spans two write-ahead
 * logs that never learn about each other.
 *
 * `headSha` is the tip as of the last time the request was refreshed, so the
 * diff a reviewer read stays addressable after the branch moves on.
 */
export const pullRequest = pgTable(
  "pull_request",
  {
    id: text()
      .primaryKey()
      .unique()
      .notNull()
      .$defaultFn(() => `pr_${createId()}`),
    // per base repository, 1-based, and what the URL carries
    number: integer().notNull(),
    title: text().notNull(),
    body: text(),
    state: pullRequestState().notNull().default("open"),

    baseRepositoryId: text()
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull(),
    baseRef: text().notNull(),
    headRepositoryId: text()
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull(),
    headRef: text().notNull(),
    headSha: text().notNull(),

    mergeCommitSha: text(),
    authorId: text()
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),

    closedAt: timestamp(),
    mergedAt: timestamp(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("pull_request_base_number_idx").on(
      t.baseRepositoryId,
      t.number,
    ),

    // One open request per branch pair. Closed and merged rows are history, so
    // the constraint has to be partial or reopening the same branch is blocked.
    uniqueIndex("pull_request_open_branch_idx")
      .on(t.baseRepositoryId, t.baseRef, t.headRepositoryId, t.headRef)
      .where(sql`${t.state} = 'open'`),

    index("pull_request_head_idx").on(t.headRepositoryId),
    index("pull_request_base_state_idx").on(t.baseRepositoryId, t.state),
  ],
);

/** Timeline comments on a pull request, oldest first. */
export const pullRequestComment = pgTable(
  "pull_request_comment",
  {
    id: text()
      .primaryKey()
      .unique()
      .notNull()
      .$defaultFn(() => `prc_${createId()}`),
    pullRequestId: text()
      .references(() => pullRequest.id, { onDelete: "cascade" })
      .notNull(),
    authorId: text()
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
    body: text().notNull(),

    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index("pull_request_comment_pull_request_idx").on(
      t.pullRequestId,
      t.createdAt,
    ),
  ],
);
