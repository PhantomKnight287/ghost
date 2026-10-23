import { type Database, schema } from '@ghost/db';
import DataLoader from 'dataloader';
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { GithubRequest } from '../../github/auth/github-request.js';
import { rulesetColumns } from '../rulesets/ruleset-columns.js';
import type { Ruleset } from '../rulesets/rulesets.types.js';
import { reviewsOf, usersByEmailOf } from './node-lookup.js';
import type { UserRow } from './nodes.js';

function byKey<Row>(rows: Row[], key: (row: Row) => string | null) {
  return new Map(
    rows.flatMap((row) => {
      const k = key(row);
      return k ? [[k, row] as const] : [];
    }),
  );
}

/** Per-request batch loaders; one set per GraphQL request so nothing is cached across viewers. */
export function createLoaders(db: Database) {
  return {
    usersById: new DataLoader<string, UserRow | null>(async (ids) => {
      const found = byKey(
        await db
          .select()
          .from(schema.user)
          .where(inArray(schema.user.id, [...ids])),
        (row) => row.id,
      );
      return ids.map((id) => found.get(id) ?? null);
    }),
    /** Logins match without regard to case, as on GitHub. */
    usersByLogin: new DataLoader<string, UserRow | null>(async (logins) => {
      const found = byKey(
        await db
          .select()
          .from(schema.user)
          .where(
            inArray(
              sql`lower(${schema.user.username})`,
              logins.map((login) => login.toLowerCase()),
            ),
          ),
        (row) => row.username?.toLowerCase() ?? null,
      );
      return logins.map((login) => found.get(login.toLowerCase()) ?? null);
    }),
    /** Keyed by lowercased email; see usersByEmailOf. */
    usersByEmail: new DataLoader<string, UserRow | null>(async (emails) => {
      const found = await usersByEmailOf(db, [...emails]);
      return emails.map((email) => found.get(email) ?? null);
    }),
    issueNumericIds: new DataLoader<string, number | null>(async (ids) => {
      const found = new Map(
        (
          await db
            .select({ id: schema.issue.id, numericId: schema.issue.numericId })
            .from(schema.issue)
            .where(inArray(schema.issue.id, [...ids]))
        ).map((row) => [row.id, row.numericId]),
      );
      return ids.map((id) => found.get(id) ?? null);
    }),
    /** Active rulesets per repository id, read once however many pull requests a query lists. */
    activeRulesetsByRepositoryId: new DataLoader<string, Ruleset[]>(
      async (ids) => {
        const rows = await db
          .select({
            ...rulesetColumns,
            repositoryId: schema.ruleset.repositoryId,
          })
          .from(schema.ruleset)
          .where(
            and(
              inArray(schema.ruleset.repositoryId, [...ids]),
              eq(schema.ruleset.enforcement, 'active'),
            ),
          );
        return ids.map((id) => rows.filter((row) => row.repositoryId === id));
      },
    ),
    /** Submitted reviews per pull_request id, oldest first; pending ones are their author's alone. */
    reviewsByPullRequestId: new DataLoader<string, ReviewRow[]>(async (ids) => {
      const rows = await reviewsOf(db, [...ids]);
      return ids.map((id) => rows.filter((row) => row.pullRequestId === id));
    }),
  };
}

export type ReviewRow = Awaited<ReturnType<typeof reviewsOf>>[number];

export type Loaders = ReturnType<typeof createLoaders>;
export type GraphqlContext = { req: GithubRequest; loaders: Loaders };
