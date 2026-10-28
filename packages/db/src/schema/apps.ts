import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth.js";

export const app = pgTable(
  "app",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => `app_${createId()}`),
    numericId: bigint({ mode: "number" })
      .generatedAlwaysAsIdentity()
      .notNull()
      .unique(),
    slug: text().notNull().unique(),
    name: text().notNull(),
    description: text(),
    homepageUrl: text().notNull(),
    setupUrl: text(),
    logoUrl: text(),
    webhookUrl: text(),
    webhookSecret: text(),
    permissions: jsonb().$type<Record<string, "read" | "write">>().notNull(),
    events: text().array().notNull(),
    ownerUserId: text().references(() => user.id, { onDelete: "set null" }),
    ownerOrganizationId: text("owner_organization_id").references(
      () => organization.id,
      { onDelete: "set null" },
    ),
    botUserId: text("bot_user_id")
      .notNull()
      .unique()
      .references(() => user.id), // no cascade
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check(
      "app_owner",
      sql`${t.deletedAt} is not null or num_nonnulls(${t.ownerUserId}, ${t.ownerOrganizationId}) = 1`,
    ),
    index("app_owner_user_id_idx").on(t.ownerUserId),
    index("app_owner_organization_id_idx").on(t.ownerOrganizationId),
  ],
);

export const appPublicKey = pgTable(
  "app_public_key",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => `apk_${createId()}`),
    appId: text()
      .notNull()
      .references(() => app.id, { onDelete: "cascade" }),
    publicKey: text().notNull(), // SPKI PEM
    fingerprint: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("app_public_key_app_id_idx").on(t.appId)],
);
