import { createId } from "@paralleldrive/cuid2";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { app, appInstallation } from "./apps.js";
import { repository } from "./repository.js";

export const checkStatus = pgEnum("check_status", [
  "queued",
  "in_progress",
  "completed",
]);

export const checkConclusion = pgEnum("check_conclusion", [
  "success",
  "failure",
  "neutral",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
]);

export const checkAnnotationLevel = pgEnum("check_annotation_level", [
  "notice",
  "warning",
  "failure",
]);

/** One per app per head commit. Its status and conclusion are derived from its newest run per name and stored so lists need not recompute them. */
export const checkSuite = pgTable(
  "check_suite",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => `csu_${createId()}`),
    // Integer id for the GitHub compatibility layer only.
    numericId: bigint({ mode: "number" })
      .generatedAlwaysAsIdentity()
      .notNull()
      .unique(),
    repositoryId: text()
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull(),
    headSha: text().notNull(),
    headBranch: text(),
    // Apps are soft-deleted, so the suite stays attributed.
    appId: text()
      .references(() => app.id)
      .notNull(),
    installationId: text().references(() => appInstallation.id, {
      onDelete: "set null",
    }),
    status: checkStatus().notNull().default("queued"),
    conclusion: checkConclusion(),
    // The push that created it, when one did.
    before: text(),
    after: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.repositoryId, t.headSha, t.appId)],
);

/** Mutable: an app moves it from queued to completed with PATCHes. A re-run is a new run with the same name; the newest per app and name is the current one. */
export const checkRun = pgTable(
  "check_run",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => `crn_${createId()}`),
    numericId: bigint({ mode: "number" })
      .generatedAlwaysAsIdentity()
      .notNull()
      .unique(),
    suiteId: text()
      .references(() => checkSuite.id, { onDelete: "cascade" })
      .notNull(),
    repositoryId: text()
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull(),
    headSha: text().notNull(),
    name: text().notNull(),
    status: checkStatus().notNull().default("queued"),
    conclusion: checkConclusion(),
    startedAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    // `check_run.completed` fires once, the first time the run completes.
    completedOnce: boolean().notNull().default(false),
    externalId: text(),
    detailsUrl: text(),
    outputTitle: text(),
    outputSummary: text(),
    outputText: text(),
    actions: jsonb()
      .$type<{ label: string; description: string; identifier: string }[]>()
      .notNull()
      .default([]),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("check_run_lookup_idx").on(
      t.repositoryId,
      t.headSha,
      t.name,
      t.createdAt.desc(),
    ),
    index("check_run_suite_idx").on(t.suiteId),
  ],
);

/** Appended by each create or update; never replaced. */
export const checkAnnotation = pgTable(
  "check_annotation",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => `can_${createId()}`),
    numericId: bigint({ mode: "number" })
      .generatedAlwaysAsIdentity()
      .notNull()
      .unique(),
    runId: text()
      .references(() => checkRun.id, { onDelete: "cascade" })
      .notNull(),
    path: text().notNull(),
    startLine: integer().notNull(),
    endLine: integer().notNull(),
    startColumn: integer(),
    endColumn: integer(),
    annotationLevel: checkAnnotationLevel().notNull(),
    message: text().notNull(),
    title: text(),
    rawDetails: text(),
  },
  (t) => [index("check_annotation_run_idx").on(t.runId, t.numericId)],
);
