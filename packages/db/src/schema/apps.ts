import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth.js";
import { repository } from "./repository.js";

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

export const appRepositorySelection = pgEnum("app_repository_selection", [
  "all",
  "selected",
]);

/** An app installed on one account. `permissions` and `events` are what the account's owner accepted, which enforcement reads instead of the app's current set. */
export const appInstallation = pgTable(
  "app_installation",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => `ain_${createId()}`),
    // The installation id GitHub's paths take.
    numericId: bigint({ mode: "number" })
      .generatedAlwaysAsIdentity()
      .notNull()
      .unique(),
    appId: text()
      .notNull()
      .references(() => app.id, { onDelete: "cascade" }),
    accountUserId: text().references(() => user.id, { onDelete: "cascade" }),
    accountOrganizationId: text().references(() => organization.id, {
      onDelete: "cascade",
    }),
    repositorySelection: appRepositorySelection().notNull(),
    permissions: jsonb().$type<Record<string, "read" | "write">>().notNull(),
    events: text().array().notNull(),
    installedById: text().references(() => user.id, { onDelete: "set null" }),
    suspendedAt: timestamp({ withTimezone: true }),
    suspendedById: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    check(
      "app_installation_account",
      sql`num_nonnulls(${t.accountUserId}, ${t.accountOrganizationId}) = 1`,
    ),
    // NULLs are distinct, so each index only constrains the account kind that sets its column.
    uniqueIndex("app_installation_user_idx").on(t.appId, t.accountUserId),
    uniqueIndex("app_installation_organization_idx").on(
      t.appId,
      t.accountOrganizationId,
    ),
    index("app_installation_account_user_id_idx").on(t.accountUserId),
    index("app_installation_account_organization_id_idx").on(
      t.accountOrganizationId,
    ),
  ],
);

/** The repositories of an installation whose selection is `selected`. */
export const appInstallationRepository = pgTable(
  "app_installation_repository",
  {
    installationId: text()
      .notNull()
      .references(() => appInstallation.id, { onDelete: "cascade" }),
    repositoryId: text()
      .notNull()
      .references(() => repository.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.installationId, t.repositoryId] }),
    index("app_installation_repository_repository_id_idx").on(t.repositoryId),
  ],
);

export const appInstallationToken = pgTable(
  "app_installation_token",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => `ait_${createId()}`),
    installationId: text()
      .notNull()
      .references(() => appInstallation.id, { onDelete: "cascade" }),
    tokenHash: text().notNull().unique(),
    permissions: jsonb().$type<Record<string, "read" | "write">>().notNull(),
    // Null: every repository of the installation.
    repositoryIds: text().array(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("app_installation_token_installation_id_idx").on(t.installationId),
    index("app_installation_token_expires_at_idx").on(t.expiresAt),
  ],
);
