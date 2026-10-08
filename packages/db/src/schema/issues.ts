import { createId } from "@paralleldrive/cuid2";
import {
  bigint,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { repository } from "./repository.js";

export const issueState = pgEnum("issue_state", ["open", "closed"]);

export const issueEventType = pgEnum("issue_event_type", [
  "opened",
  "closed",
  "reopened",
  "renamed",
  "edited",
  "labeled",
  "unlabeled",
  "assigned",
  "unassigned",
  "merged",
  "ready_for_review",
  "converted_to_draft",
  // a commit a push added to a pull request's head, and a push that rewrote it
  "committed",
  "head_force_pushed",
]);

export const issueReferenceSource = pgEnum("issue_reference_source", [
  "issue",
  "comment",
  "commit",
]);

/** `number` is per repository, 1-based, and what the URL carries; a pull request is an issue with a `pull_request` row, sharing its number sequence, comment thread and timeline. `commentCount` is denormalized for `sort=comments`; writers must bump it on comment create/delete. */
export const issue = pgTable(
  "issue",
  {
    id: text()
      .primaryKey()
      .unique()
      .notNull()
      .$defaultFn(() => `issue_${createId()}`),
    repositoryId: text()
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull(),
    number: integer().notNull(),
    title: text().notNull(),
    body: text(),
    state: issueState().notNull().default("open"),
    isPullRequest: boolean().notNull().default(false),

    authorId: text()
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
    closedById: text().references(() => user.id, { onDelete: "set null" }),

    commentCount: integer().notNull().default(0),

    closedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("issue_repo_number_idx").on(t.repositoryId, t.number),
    index("issue_repo_kind_state_idx").on(
      t.repositoryId,
      t.isPullRequest,
      t.state,
    ),
    index("issue_repo_updated_idx").on(t.repositoryId, t.updatedAt),
  ],
);

export const issueComment = pgTable(
  "issue_comment",
  {
    id: text()
      .primaryKey()
      .unique()
      .notNull()
      .$defaultFn(() => `ic_${createId()}`),
    issueId: text()
      .references(() => issue.id, { onDelete: "cascade" })
      .notNull(),
    authorId: text()
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
    body: text().notNull(),
    githubId: bigint({ mode: "number" }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index("issue_comment_issue_idx").on(t.issueId, t.createdAt),
    uniqueIndex("issue_comment_issue_github_idx").on(t.issueId, t.githubId),
  ],
);

export const label = pgTable(
  "label",
  {
    id: text()
      .primaryKey()
      .unique()
      .notNull()
      .$defaultFn(() => `label_${createId()}`),
    repositoryId: text()
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull(),
    name: text().notNull(),
    description: text(),
    // 6 hex chars, lowercase, no `#` — the client adds `#` when rendering
    color: text().notNull().default("ededed"),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("label_repo_name_idx").on(t.repositoryId, t.name),
    index("label_repo_idx").on(t.repositoryId),
  ],
);

export const issueLabel = pgTable(
  "issue_label",
  {
    issueId: text()
      .references(() => issue.id, { onDelete: "cascade" })
      .notNull(),
    labelId: text()
      .references(() => label.id, { onDelete: "cascade" })
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.labelId] })],
);

export const issueAssignee = pgTable(
  "issue_assignee",
  {
    issueId: text()
      .references(() => issue.id, { onDelete: "cascade" })
      .notNull(),
    userId: text()
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.userId] })],
);

/** Audit timeline for an issue — what GitHub renders between comments. Only the columns relevant to `type` are set; a `closed` event carries `sourceIssueId` or `commitSha` when a pull request or commit closed it. A `committed` event keeps its commit's subject and author, since a later force push can leave the commit unreachable; `head_force_pushed` goes from `beforeSha` to `commitSha`. */
export const issueEvent = pgTable(
  "issue_event",
  {
    id: text()
      .primaryKey()
      .unique()
      .notNull()
      .$defaultFn(() => `iev_${createId()}`),
    issueId: text()
      .references(() => issue.id, { onDelete: "cascade" })
      .notNull(),
    actorId: text().references(() => user.id, { onDelete: "set null" }),
    type: issueEventType().notNull(),

    labelName: text(),
    assigneeUsername: text(),
    oldTitle: text(),
    newTitle: text(),
    sourceIssueId: text().references(() => issue.id, { onDelete: "set null" }),
    commitSha: text(),
    beforeSha: text(),
    commitMessage: text(),
    commitAuthorName: text(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("issue_event_issue_idx").on(t.issueId, t.createdAt)],
);

/** One row per `#N` written somewhere, resolved on save so a timeline read is one indexed lookup on `targetIssueId`. `sourceId` is the issue id, comment id or commit sha holding the text, and an edit replaces all its rows; `sourceIssueId` is the issue or pull request it belongs to, null for a commit. */
export const issueReference = pgTable(
  "issue_reference",
  {
    id: text()
      .primaryKey()
      .unique()
      .notNull()
      .$defaultFn(() => `iref_${createId()}`),
    sourceType: issueReferenceSource().notNull(),
    sourceId: text().notNull(),
    sourceRepositoryId: text()
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull(),
    sourceIssueId: text().references(() => issue.id, { onDelete: "cascade" }),
    targetIssueId: text()
      .references(() => issue.id, { onDelete: "cascade" })
      .notNull(),
    closing: boolean().notNull().default(false),
    actorId: text().references(() => user.id, { onDelete: "set null" }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("issue_reference_source_target_idx").on(
      t.sourceType,
      t.sourceId,
      t.targetIssueId,
    ),
    index("issue_reference_target_idx").on(t.targetIssueId, t.createdAt),
    index("issue_reference_source_issue_idx").on(t.sourceIssueId),
  ],
);
