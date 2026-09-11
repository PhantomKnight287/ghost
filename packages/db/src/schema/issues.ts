import { createId } from "@paralleldrive/cuid2";
import {
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
]);

/**
 * GitHub-style issue. `number` is per repository, 1-based, and what the URL
 * carries — same convention as `pull_request.number`.
 *
 * `commentCount` is denormalized so `sort=comments` is one indexed query
 * instead of a join + group-by on every list call. Writers must bump it on
 * comment create/delete.
 */
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
    // per repository, 1-based, and what the URL carries
    number: integer().notNull(),
    title: text().notNull(),
    body: text(),
    state: issueState().notNull().default("open"),

    authorId: text()
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
    closedById: text().references(() => user.id, { onDelete: "set null" }),

    commentCount: integer().notNull().default(0),

    closedAt: timestamp(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("issue_repo_number_idx").on(t.repositoryId, t.number),
    index("issue_repo_state_idx").on(t.repositoryId, t.state),
    index("issue_repo_updated_idx").on(t.repositoryId, t.updatedAt),
  ],
);

/** Timeline comments on an issue, oldest first. */
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

    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [index("issue_comment_issue_idx").on(t.issueId, t.createdAt)],
);

/**
 * Repository-scoped labels, exactly like GitHub: a name, an optional
 * description, and a 6-char hex color (stored without `#`).
 */
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

    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp()
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

/**
 * Audit timeline for an issue — what GitHub renders between comments:
 * opened/closed/reopened/renamed/edited/labeled/unlabeled/assigned/unassigned.
 * Only the columns relevant to `type` are set.
 */
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

    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [index("issue_event_issue_idx").on(t.issueId, t.createdAt)],
);
