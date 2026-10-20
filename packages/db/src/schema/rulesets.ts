import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { team, user } from "./auth.js";
import { repositoryRole } from "./collaborators.js";
import { repository } from "./repository.js";

export const rulesetTarget = pgEnum("ruleset_target", ["branch", "tag"]);

export const rulesetEnforcement = pgEnum("ruleset_enforcement", [
  "active",
  "disabled",
]);

export const rulesetRuleType = pgEnum("ruleset_rule_type", [
  "creation",
  "update",
  "deletion",
  "non_fast_forward",
  "required_linear_history",
]);

export const rulesetBypassActorType = pgEnum("ruleset_bypass_actor_type", [
  "RepositoryRole",
  "Team",
  "OrganizationAdmin",
]);

export const rulesetBypassMode = pgEnum("ruleset_bypass_mode", [
  "always",
  "pull_request",
]);

export const ruleset = pgTable(
  "ruleset",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => `ruleset_${createId()}`),
    // Integer id for the GitHub compatibility layer only (REST `id`, GraphQL `databaseId`); nothing references it and Ghost's own API does not expose it.
    numericId: bigint({ mode: "number" })
      .generatedAlwaysAsIdentity()
      .notNull()
      .unique(),
    repositoryId: text()
      .notNull()
      .references(() => repository.id, { onDelete: "cascade" }),
    name: text().notNull(),
    target: rulesetTarget().notNull(),
    enforcement: rulesetEnforcement().default("active").notNull(),
    include: text().array().notNull().default([]),
    exclude: text().array().notNull().default([]),
    createdById: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  // Leads with repository_id, so it also serves loading a repository's rulesets.
  (t) => [unique().on(t.repositoryId, t.name)],
);

/** Replaced as a set whenever its ruleset is saved, so rows carry no id or timestamps. */
export const rulesetRule = pgTable(
  "ruleset_rule",
  {
    rulesetId: text()
      .notNull()
      .references(() => ruleset.id, { onDelete: "cascade" }),
    type: rulesetRuleType().notNull(),
    parameters: jsonb().notNull().default({}),
  },
  (t) => [primaryKey({ columns: [t.rulesetId, t.type] })],
);

/** Replaced as a set whenever its ruleset is saved, so rows carry no id or timestamps. */
export const rulesetBypassActor = pgTable(
  "ruleset_bypass_actor",
  {
    rulesetId: text()
      .notNull()
      .references(() => ruleset.id, { onDelete: "cascade" }),
    actorType: rulesetBypassActorType().notNull(),
    role: repositoryRole(),
    teamId: text().references(() => team.id, { onDelete: "cascade" }),
    bypassMode: rulesetBypassMode().notNull(),
  },
  (t) => [
    check(
      "ruleset_bypass_actor_target",
      sql`(actor_type = 'RepositoryRole' AND role IS NOT NULL AND team_id IS NULL)
        OR (actor_type = 'Team' AND team_id IS NOT NULL AND role IS NULL)
        OR (actor_type = 'OrganizationAdmin' AND role IS NULL AND team_id IS NULL)`,
    ),
    // NULLs are distinct, so each index only constrains the actor type that sets its column. The first also serves lookups by ruleset.
    uniqueIndex("ruleset_bypass_actor_role_idx").on(t.rulesetId, t.role),
    uniqueIndex("ruleset_bypass_actor_team_idx").on(t.rulesetId, t.teamId),
  ],
);
