import { createId } from "@paralleldrive/cuid2";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth.js";
import { oauthClient } from "./oauth.js";

/** Ghost's refresh tokens for OAuth apps with expiring user tokens. Only the token's sha256 is stored. */
export const oauthAppRefreshToken = pgTable(
  "oauth_app_refresh_token",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => `ort_${createId()}`),
    tokenHash: text().notNull().unique(),
    clientId: text()
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    scopes: text().array().notNull(),
    // No foreign key: the api-key plugin deletes expired keys, and the refresh token must outlive its access key.
    accessKeyId: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("oauth_app_refresh_token_client_user_idx").on(t.clientId, t.userId),
  ],
);
