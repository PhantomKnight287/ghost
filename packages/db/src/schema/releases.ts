import { createId } from "@paralleldrive/cuid2";
import {
  bigint,
  boolean,
  index,
  integer,
  pgEnum,
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

/** `uploading` rows are reservations: they count against the owner's quota while the bytes stream to object storage, so two concurrent uploads cannot both squeeze under it. */
export const releaseAssetState = pgEnum("release_asset_state", [
  "uploading",
  "uploaded",
]);

/** A file attached to a release. The bytes live in object storage under `release-assets/<repositoryId>/<id>`. */
export const releaseAsset = pgTable(
  "release_asset",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => `asset_${createId()}`),
    releaseId: text()
      .references(() => release.id, { onDelete: "cascade" })
      .notNull(),
    // Denormalized from the release, so an account's usage is one join to `repository` and the object key survives the release row.
    repositoryId: text()
      .references(() => repository.id, { onDelete: "cascade" })
      .notNull(),
    name: text().notNull(),
    contentType: text().notNull(),
    size: bigint({ mode: "number" }).notNull(),
    state: releaseAssetState().notNull().default("uploading"),
    downloadCount: integer().notNull().default(0),
    uploaderId: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("release_asset_release_name_idx").on(t.releaseId, t.name),
    index("release_asset_repository_idx").on(t.repositoryId),
  ],
);
