import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { organization, team, user } from "./auth.js";
import { repositoryRole } from "./collaborators.js";
import { repository } from "./repository.js";

/** What Ghost knows about an organization beyond Better Auth's row: its policies and its public profile. One row per organization, written when it is created. */
export const organizationSettings = pgTable("organization_settings", {
  organizationId: text()
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  // Every member's floor on every repository. Null is no access beyond teams and collaborations.
  basePermission: repositoryRole().default("read"),
  membersCanCreatePublicRepositories: boolean().notNull().default(true),
  membersCanCreatePrivateRepositories: boolean().notNull().default(true),
  allowPrivateForks: boolean().notNull().default(false),
  // Recorded on each new repository, and followed once a branch by that name is pushed.
  defaultBranch: text(),
  description: text(),
  website: text(),
  location: text(),
  email: text(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date()),
});

/** Members who chose to show their membership. Membership is private otherwise. */
export const organizationPublicMember = pgTable(
  "organization_public_member",
  {
    organizationId: text()
      .references(() => organization.id, { onDelete: "cascade" })
      .notNull(),
    userId: text()
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] })],
);

export const organizationPinnedRepository = pgTable(
  "organization_pinned_repository",
  {
    organizationId: text()
      .references(() => organization.id, { onDelete: "cascade" })
      .notNull(),
    repositoryId: text()
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull(),
    position: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.repositoryId] })],
);

/** Members who may manage one team's membership without administering the organization. */
export const teamMaintainer = pgTable(
  "team_maintainer",
  {
    teamId: text()
      .references(() => team.id, { onDelete: "cascade" })
      .notNull(),
    userId: text()
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

/** Where a repository used to be, so links and git remotes survive a rename or a transfer. A repository created at the old name takes precedence. */
export const repositoryRedirect = pgTable(
  "repository_redirect",
  {
    ownerName: text().notNull(),
    slug: text().notNull(),
    repositoryId: text()
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("repository_redirect_name_idx").on(
      sql`lower(${t.ownerName})`,
      t.slug,
    ),
    index("repository_redirect_repository_idx").on(t.repositoryId),
  ],
);

/** A transfer waiting for its recipient: a user accepts for themselves, an organization's admins for it. Exactly one of the two targets is set. */
export const repositoryTransfer = pgTable("repository_transfer", {
  repositoryId: text()
    .primaryKey()
    .references(() => repository.id, { onDelete: "cascade" }),
  toUserId: text().references(() => user.id, { onDelete: "cascade" }),
  toOrganizationId: text().references(() => organization.id, {
    onDelete: "cascade",
  }),
  requestedById: text().references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
