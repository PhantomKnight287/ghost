import { type Database, schema } from '@ghost/db';
import DataLoader from 'dataloader';
import { inArray } from 'drizzle-orm';

import type { GithubRequest } from '../../github/auth/github-request.js';
import type { UserRow } from './nodes.js';

function byKey<Row>(rows: Row[], key: (row: Row) => string | null) {
  return new Map(rows.flatMap((row) => { const k = key(row); return k ? [[k, row] as const] : []; }));
}

/** Per-request batch loaders; one set per GraphQL request so nothing is cached across viewers. */
export function createLoaders(db: Database) {
  return {
    usersById: new DataLoader<string, UserRow | null>(async (ids) => {
      const found = byKey(await db.select().from(schema.user).where(inArray(schema.user.id, [...ids])), (row) => row.id);
      return ids.map((id) => found.get(id) ?? null);
    }),
    usersByLogin: new DataLoader<string, UserRow | null>(async (logins) => {
      const found = byKey(await db.select().from(schema.user).where(inArray(schema.user.username, [...logins])), (row) => row.username);
      return logins.map((login) => found.get(login) ?? null);
    }),
  };
}

export type Loaders = ReturnType<typeof createLoaders>;
export type GraphqlContext = { req: GithubRequest; loaders: Loaders };
