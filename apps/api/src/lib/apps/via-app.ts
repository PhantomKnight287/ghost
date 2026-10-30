import { schema } from '@ghost/db';
import { type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { userToServerCaller } from './user-token-context.js';

/** The app a `ghu_` token acted through, shown as "via" beside its user; null for anything else, and once the app is deleted. */
export type ViaApp = {
  appId: number;
  slug: string;
  name: string;
  logoUrl: string | null;
};

/** What a write records as `via_app_id`: the app behind the request's `ghu_` token, if any. */
export const currentViaAppId = () =>
  userToServerCaller.getStore()?.appId ?? null;

/** `column`'s app as a `ViaApp`, a scalar subquery, so no select needs another join. */
export function viaAppOf(column: AnyPgColumn | SQL): SQL<ViaApp | null> {
  return sql<ViaApp | null>`(select json_build_object('appId', ${schema.app.numericId}, 'slug', ${schema.app.slug}, 'name', ${schema.app.name}, 'logoUrl', ${schema.app.logoUrl}) from ${schema.app} where ${schema.app.id} = ${column} and ${schema.app.deletedAt} is null)`;
}
