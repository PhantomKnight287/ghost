import { createId } from "@paralleldrive/cuid2";
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { repository } from "./repository.js";

/** Notes attached to a tag. The tag itself lives in git, so a release outlives a deleted tag and simply stops pointing at a commit. */
export const release = pgTable(
  "release",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => `release_${createId()}`),
    repositoryId: text()
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull(),
    // Tag name without `refs/tags/`.
    tagName: text().notNull(),
    // Null reads as the tag name.
    name: text(),
    body: text(),
    isDraft: boolean().notNull().default(false),
    isPrerelease: boolean().notNull().default(false),
    authorId: text().references(() => user.id, { onDelete: "set null" }),
    // Null while a draft; set once, when it is first published.
    publishedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("release_repository_tag_idx").on(t.repositoryId, t.tagName),
    index("release_repository_created_idx").on(t.repositoryId, t.createdAt),
  ],
);
