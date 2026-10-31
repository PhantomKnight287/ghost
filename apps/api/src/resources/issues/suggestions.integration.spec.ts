import path from 'node:path';
import { createDatabase, type Database, type Pool, schema } from '@ghost/db';
import { inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { SuggestionsService } from './suggestions.service.js';

const CONNECTION = process.env.TEST_DATABASE_URL;
const MIGRATIONS = path.resolve(
  import.meta.dirname,
  '../../../../../packages/db/drizzle',
);

const USERS = {
  owner: 'user_suggest_owner',
  collaborator: 'user_suggest_collaborator',
  commenter: 'user_suggest_commenter',
  stranger: 'user_suggest_stranger',
};

// Needs a throwaway Postgres; the suite is skipped without one.
describe.skipIf(!CONNECTION)('suggestions', () => {
  let db: Database;
  let pool: Pool;
  let suggestions: SuggestionsService;
  const target = { username: 'suggest-owner', repo: 'app' };

  beforeAll(async () => {
    ({ db, pool } = createDatabase({ connectionString: CONNECTION }));
    await migrate(db, { migrationsFolder: MIGRATIONS });
    suggestions = new SuggestionsService(db, new RepositoryAccessService(db));

    await db
      .delete(schema.user)
      .where(inArray(schema.user.id, Object.values(USERS)));
    await db.insert(schema.user).values(
      Object.entries(USERS).map(([role, id]) => ({
        id,
        name: role,
        email: `suggest-${role}@example.com`,
        username: `suggest-${role}`,
      })),
    );
    const [repository] = await db
      .insert(schema.repository)
      .values({
        name: 'app',
        slug: 'app',
        ownerId: USERS.owner,
        visibility: 'public',
      })
      .returning();
    await db.insert(schema.repositoryCollaborator).values({
      repositoryId: repository.id,
      userId: USERS.collaborator,
      role: 'write',
      acceptedAt: new Date(),
    });
    const [first] = await db
      .insert(schema.issue)
      .values([
        {
          repositoryId: repository.id,
          number: 1,
          title: 'Login fails',
          authorId: USERS.owner,
        },
        {
          repositoryId: repository.id,
          number: 12,
          title: 'Add dark mode',
          authorId: USERS.owner,
          isPullRequest: true,
        },
        {
          repositoryId: repository.id,
          number: 2,
          title: 'Crash on login',
          authorId: USERS.owner,
          state: 'closed',
        },
      ])
      .returning();
    await db.insert(schema.issueComment).values({
      issueId: first.id,
      authorId: USERS.commenter,
      body: 'Same here',
    });
  });

  afterAll(async () => {
    await db
      .delete(schema.user)
      .where(inArray(schema.user.id, Object.values(USERS)));
    await pool?.end();
  });

  it('suggests the people involved in the repository when nothing is typed', async () => {
    const { users } = await suggestions.users(target);
    expect(users.map((user) => user.username)).toEqual([
      'suggest-collaborator',
      'suggest-commenter',
      'suggest-owner',
    ]);
  });

  it('matches anyone by username prefix, the involved first', async () => {
    const { users } = await suggestions.users({ ...target, q: 'suggest-' });
    expect(users.map((user) => user.username)).toEqual([
      'suggest-collaborator',
      'suggest-commenter',
      'suggest-owner',
      'suggest-stranger',
    ]);
    expect(
      (await suggestions.users({ ...target, q: 'SUGGEST-st' })).users,
    ).toEqual([
      { username: 'suggest-stranger', name: 'stranger', image: null },
    ]);
    expect((await suggestions.users({ ...target, q: '%' })).users).toEqual([]);
  });

  it('suggests issues and pull requests by number prefix or title, newest first', async () => {
    const numbers = async (q?: string) =>
      (await suggestions.issues({ ...target, q })).issues.map(
        (issue) => issue.number,
      );

    expect(await numbers()).toEqual([12, 2, 1]);
    expect(await numbers('1')).toEqual([12, 1]);
    expect(await numbers('login')).toEqual([2, 1]);
    expect((await suggestions.issues({ ...target, q: '12' })).issues).toEqual([
      {
        number: 12,
        title: 'Add dark mode',
        state: 'open',
        isPullRequest: true,
      },
    ]);
  });
});
