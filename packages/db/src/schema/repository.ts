import { createId } from "@paralleldrive/cuid2";
import { pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organization, user } from "./auth.js";
import { isNotNull, isNull } from "drizzle-orm";

export const repositoryVisiblity = pgEnum("repository_visibility", ['public','private'])

export const repository = pgTable("repository", {
  id: text().primaryKey().unique().notNull().$defaultFn(() => `repo_${createId()}`),
  name: text().notNull(),
  slug: text().notNull(),
  description: text(),
  // nullable cus a repo can also belong to just a user
  organizationId: text().references(() => organization.id, { onDelete: "cascade" }),
  // a repo will always have an owner. will also allow them to transfer the ownership incase they wanna preserve the repo but delete the account
  ownerId:text().references(()=>user.id,{onDelete:"cascade"}).notNull(),

  visibility: repositoryVisiblity().notNull().default('private'),
  lastPushedAt:timestamp().notNull().defaultNow(),

  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow().$onUpdateFn(() => new Date()),

}, (t) => [
  uniqueIndex("repository_org_slug_idx")
     .on(t.organizationId, t.slug)
     .where(isNotNull(t.organizationId)),

   uniqueIndex("repository_owner_slug_idx")
     .on(t.ownerId, t.slug)
     .where(isNull(t.organizationId)),
])
