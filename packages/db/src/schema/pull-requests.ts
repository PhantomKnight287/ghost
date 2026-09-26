import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { issue } from "./issues.js";
import { repository } from "./repository.js";

export const pullRequestState = pgEnum("pull_request_state", [
  "open",
  "closed",
  "merged",
]);

/**
 * Base and head are stored as separate repository ids because they are only the same row for a branch-to-branch request; a fork request spans two write-ahead logs that never learn about each other.
 *
 * `headSha` is the tip as of the last time the request was refreshed, so the diff a reviewer read stays addressable after the branch moves on.
 *
 * Number, title, body, author and comments live on the `issue` row; this row holds only what a git comparison needs. `state` keeps `merged`, which an issue has no word for, and is kept in step with `issue.state`.
 */
export const pullRequest = pgTable(
  "pull_request",
  {
    id: text()
      .primaryKey()
      .unique()
      .notNull()
      .$defaultFn(() => `pr_${createId()}`),
    issueId: text()
      .references(() => issue.id, { onDelete: "cascade" })
      .notNull()
      .unique(),
    state: pullRequestState().notNull().default("open"),

    baseRepositoryId: text()
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull(),
    baseRef: text().notNull(),
    // Null once the head repository is deleted. It cannot be deleted while it heads an open request, so only closed and merged requests lose it.
    headRepositoryId: text().references(() => repository.id, {
      onDelete: "set null",
    }),
    headRef: text().notNull(),
    headSha: text().notNull(),

    mergeCommitSha: text(),

    mergedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    // One open request per branch pair. Closed and merged rows are history, so the constraint has to be partial or reopening the same branch is blocked.
    uniqueIndex("pull_request_open_branch_idx")
      .on(t.baseRepositoryId, t.baseRef, t.headRepositoryId, t.headRef)
      .where(sql`${t.state} = 'open'`),

    index("pull_request_head_idx").on(t.headRepositoryId),
    index("pull_request_base_state_idx").on(t.baseRepositoryId, t.state),
  ],
);
