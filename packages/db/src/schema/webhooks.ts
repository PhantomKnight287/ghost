import { createId } from "@paralleldrive/cuid2";
import {
  boolean,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  integer,
  index,
  check,
  uuid,
} from "drizzle-orm/pg-core";
import { repository } from "./repository.js";
import { organization } from "./auth.js";
import { sql } from "drizzle-orm";

export const webhookEndpoint = pgTable(
  "webhook_endpoint",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => `whk_${createId()}`),
    repositoryId: text().references(() => repository.id, {
      onDelete: "cascade",
    }),
    organizationId: text().references(() => organization.id, {
      onDelete: "cascade",
    }),
    url: text().notNull(),
    secret: text().notNull().unique(),
    events: text().array().notNull(),
    active: boolean().default(true).notNull(),
    disabledReason: text(),
    // Set once the owner has been emailed about the disable, so every API instance's sweep emails them once.
    disabledNotifiedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    // enforce this endpoint has only 1 owner. Either a repo or an org
    check(
      "webhook_endpoint_owner",
      sql`num_nonnulls(repository_id, organization_id) = 1`,
    ),
    index("webhook_endpoint_repository_idx").on(t.repositoryId),
    index("webhook_endpoint_organization_idx").on(t.organizationId),
  ],
);

export const deliveryJobStatus = pgEnum("delivery_job_status", [
  "pending",
  "succeeded",
  "dead",
]);

export const deliveryJobKind = pgEnum("delivery_job_kind", [
  "email",
  "webhook",
]);

export const deliveryJob = pgTable(
  "delivery_job",
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: deliveryJobKind().notNull(),
    idempotencyKey: text().unique().notNull(),
    payload: jsonb().notNull(),
    endpointId: text().references(() => webhookEndpoint.id, {
      onDelete: "cascade",
    }),
    status: deliveryJobStatus().notNull().default("pending"),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lockedUntil: timestamp({ withTimezone: true }).notNull().defaultNow(),
    claimToken: uuid().notNull().defaultRandom(),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index("delivery_job_pending_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export const deliveryAttempt = pgTable(
  "delivery_attempt",
  {
    id: uuid().primaryKey().defaultRandom(),
    jobId: uuid()
      .references(() => deliveryJob.id, { onDelete: "cascade" })
      .notNull(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    durationMs: integer().notNull(),
    statusCode: integer(),
    error: text(),
    requestHeaders: jsonb().notNull(),
    responseBody: text(),
  },
  (t) => [index("delivery_attempt_job_idx").on(t.jobId, t.startedAt)],
);
