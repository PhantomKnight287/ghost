import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { issue } from "./issues.js";
import { repository } from "./repository.js";

/**
 * Something that happened in a repository, written in the same transaction as the change itself and handed to every consumer once it commits.
 *
 * `type` is text rather than an enum so a new kind of event needs no migration; the API types what each one carries in `payload`.
 */
export const outboxEvent = pgTable(
  "outbox_event",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => `evt_${createId()}`),
    type: text().notNull(),
    repositoryId: text()
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull(),
    actorId: text().references(() => user.id, {
      onDelete: "set null",
    }),
    payload: jsonb().$type<Record<string, string>>().notNull(),

    attempts: integer().notNull().default(0),
    lastError: text(),

    createdAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("outbox_event_pending_idx")
      .on(t.createdAt, t.id)
      .where(sql`${t.processedAt} is null`),
  ],
);

export const notificationReason = pgEnum("notification_reason", [
  "assigned",
  "mentioned",
  "team_mentioned",
  "author",
  "subscribed",
  "watching",
]);

/** One row per user and thread; later activity on the thread bumps the same row back to unread. */
export const notification = pgTable(
  "notification",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => `ntf_${createId()}`),
    userId: text()
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
    issueId: text()
      .references(() => issue.id, { onDelete: "cascade" })
      .notNull(),
    reason: notificationReason().notNull(),
    // the latest event on the thread, and who caused it
    eventType: text().notNull(),
    actorId: text().references(() => user.id, {
      onDelete: "set null",
    }),
    unread: boolean().notNull().default(true),

    // milliseconds, the precision of the inbox cursor that pages on it
    updatedAt: timestamp({ withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("notification_user_issue_idx").on(t.userId, t.issueId),
    index("notification_user_updated_idx").on(t.userId, t.updatedAt),
  ],
);

/** `subscribed = false` is an explicit unsubscribe, which outlasts the automatic subscription that commenting would otherwise add back. */
export const issueSubscription = pgTable(
  "issue_subscription",
  {
    userId: text()
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
    issueId: text()
      .references(() => issue.id, { onDelete: "cascade" })
      .notNull(),
    subscribed: boolean().notNull(),

    createdAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.issueId] }),
    index("issue_subscription_issue_idx").on(t.issueId),
  ],
);

// No row means participating: notified only about threads the user takes part in.
export const repositoryWatchLevel = pgEnum("repository_watch_level", [
  "all",
  "ignore",
]);

export const repositoryWatch = pgTable(
  "repository_watch",
  {
    userId: text()
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
    repositoryId: text()
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull(),
    level: repositoryWatchLevel().notNull(),

    createdAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.repositoryId] }),
    index("repository_watch_repository_idx").on(t.repositoryId),
  ],
);
