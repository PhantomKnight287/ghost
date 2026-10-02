import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
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
    draft: boolean().notNull().default(false),

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

export const pullRequestReviewState = pgEnum("pull_request_review_state", [
  "commented",
  "approved",
  "changes_requested",
]);

export const diffSide = pgEnum("diff_side", ["deletions", "additions"]);

/**
 * A review with no `submittedAt` is pending: the reviewer's unsent batch of line comments, visible to nobody else and with no verdict yet. One per reviewer and request.
 *
 * A dismissed review keeps its verdict for the record but stops counting; `dismissalMessage` is what marks it, since `dismissedById` goes null with the account.
 */
export const pullRequestReview = pgTable(
  "pull_request_review",
  {
    id: text()
      .primaryKey()
      .unique()
      .notNull()
      .$defaultFn(() => `prr_${createId()}`),
    pullRequestId: text()
      .references(() => pullRequest.id, { onDelete: "cascade" })
      .notNull(),
    authorId: text()
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
    state: pullRequestReviewState(),
    body: text(),
    commitSha: text().notNull(),

    dismissedById: text().references(() => user.id, { onDelete: "set null" }),
    dismissalMessage: text(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("pull_request_review_pull_idx").on(t.pullRequestId, t.createdAt),
    uniqueIndex("pull_request_review_pending_idx")
      .on(t.pullRequestId, t.authorId)
      .where(sql`${t.submittedAt} is null`),
  ],
);

/**
 * A comment on one line of one side of the diff at `commitSha`, or on the lines from `startLine` on `startSide` down to `line` on `side`; once the head moves on it is outdated rather than wrong.
 *
 * A thread's first comment belongs to a review. Replies belong to no review: they carry `inReplyToId` and copy the thread's path, line and commit, but not its `diffHunk`.
 */
export const pullRequestReviewComment = pgTable(
  "pull_request_review_comment",
  {
    id: text()
      .primaryKey()
      .unique()
      .notNull()
      .$defaultFn(() => `prc_${createId()}`),
    pullRequestId: text()
      .references(() => pullRequest.id, { onDelete: "cascade" })
      .notNull(),
    reviewId: text().references(() => pullRequestReview.id, {
      onDelete: "cascade",
    }),
    inReplyToId: text().references(
      (): AnyPgColumn => pullRequestReviewComment.id,
      { onDelete: "cascade" },
    ),
    authorId: text()
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
    path: text().notNull(),
    side: diffSide().notNull(),
    line: integer().notNull(),
    startSide: diffSide(),
    startLine: integer(),
    commitSha: text().notNull(),
    // The rows of the diff the comment points at, kept as written: the conversation shows them long after the head has moved on.
    diffHunk: text(),
    body: text().notNull(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index("pull_request_review_comment_review_idx").on(t.reviewId),
    index("pull_request_review_comment_reply_idx").on(t.inReplyToId),
    index("pull_request_review_comment_pull_idx").on(t.pullRequestId),
  ],
);

/** One entry Ghost wrote into a base repository's log to keep `refs/pull/<n>/*` current, and the bytes it added. Nobody pays for them while the request is unmerged; a merge bills them to the base repository's account. */
export const pullRequestRefWrite = pgTable(
  "pull_request_ref_write",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => `prw_${createId()}`),
    pullRequestId: text()
      .references(() => pullRequest.id, { onDelete: "cascade" })
      .notNull(),
    size: bigint({ mode: "number" }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pull_request_ref_write_pull_idx").on(t.pullRequestId)],
);
