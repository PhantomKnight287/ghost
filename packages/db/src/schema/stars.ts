import { createId } from "@paralleldrive/cuid2";
import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { repository } from "./repository.js";

export const stars = pgTable(
  "stars",
  {
    id: text()
      .primaryKey()
      .unique()
      .$defaultFn(() => `star_${createId()}`)
      .notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    repositoryId: text()
      .notNull()
      .references(() => repository.id, { onDelete: "cascade" }),

    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [uniqueIndex().on(t.userId, t.repositoryId)],
);
