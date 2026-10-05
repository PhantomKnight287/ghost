import path from 'node:path';
import { runWithEndpointContext } from '@better-auth/core/context';
import { createDatabase, type Database, type Pool, schema } from '@ghost/db';
import { eq, inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Auth, createAuth, usernameForGitHubLogin } from './auth.js';

const CONNECTION = process.env.TEST_DATABASE_URL;
const MIGRATIONS = path.resolve(
  import.meta.dirname,
  '../../../../packages/db/drizzle',
);

const PRIMARY = 'auth-spec-primary@example.com';
const OTHER = 'auth-spec-other@example.com';
const OTHER_EXTRA = 'auth-spec-other-extra@example.com';
const EXTRA = 'auth-spec-extra@example.com';
const UNVERIFIED = 'auth-spec-unverified@example.com';
const PASSWORD = 'correct horse battery staple';

// Needs a throwaway Postgres; the suite is skipped without one.
describe.skipIf(!CONNECTION)('createAuth with extra addresses', () => {
  let db: Database;
  let pool: Pool;
  let auth: Auth;
  let userId: string;
  let otherUserId: string;

  async function sessionHeaders(email: string) {
    const { headers } = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      returnHeaders: true,
    });
    const cookie = headers.get('set-cookie');
    return new Headers(cookie ? { cookie } : undefined);
  }

  beforeAll(async () => {
    ({ db, pool } = createDatabase({ connectionString: CONNECTION }));
    await migrate(db, { migrationsFolder: MIGRATIONS });

    auth = createAuth(db, {
      secret: 'auth-spec-secret-auth-spec-secret',
      baseURL: 'http://localhost:3001',
    });

    await db.delete(schema.user).where(eq(schema.user.email, PRIMARY));
    await db.delete(schema.user).where(eq(schema.user.email, OTHER));
    const signUp = await auth.api.signUpEmail({
      body: { name: 'Auth Spec', email: PRIMARY, password: PASSWORD },
    });
    userId = signUp.user.id;

    const other = await auth.api.signUpEmail({
      body: { name: 'Other Spec', email: OTHER, password: PASSWORD },
    });
    otherUserId = other.user.id;
    await db.insert(schema.userEmail).values({
      id: 'uem_auth_spec_other',
      userId: otherUserId,
      email: OTHER_EXTRA,
      verified: true,
    });

    await db.insert(schema.userEmail).values([
      {
        id: 'uem_auth_spec_extra',
        userId,
        email: EXTRA,
        verified: true,
      },
      {
        id: 'uem_auth_spec_unverified',
        userId,
        email: UNVERIFIED,
        verified: false,
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(schema.user).where(eq(schema.user.id, userId));
    await db.delete(schema.user).where(eq(schema.user.id, otherUserId));
    await pool.end();
  });

  it('signs in with the primary address', async () => {
    const result = await auth.api.signInEmail({
      body: { email: PRIMARY, password: PASSWORD },
    });
    expect(result.user.id).toBe(userId);
  });

  it('signs in with a verified extra address', async () => {
    const result = await auth.api.signInEmail({
      body: { email: EXTRA, password: PASSWORD },
    });
    // Better Auth still only ever sees the account address.
    expect(result.user.id).toBe(userId);
    expect(result.user.email).toBe(PRIMARY);
  });

  it('refuses to change to an address another account holds', async () => {
    const headers = await sessionHeaders(PRIMARY);

    // Another account's primary.
    await expect(
      auth.api.changeEmail({ body: { newEmail: OTHER }, headers }),
    ).rejects.toThrow(/already taken/i);

    // And another account's verified extra, which Better Auth alone would happily hand over.
    await expect(
      auth.api.changeEmail({ body: { newEmail: OTHER_EXTRA }, headers }),
    ).rejects.toThrow(/already taken/i);
  });

  it('refuses to change to an unconfirmed address of its own', async () => {
    const headers = await sessionHeaders(PRIMARY);

    await expect(
      auth.api.changeEmail({ body: { newEmail: UNVERIFIED }, headers }),
    ).rejects.toThrow(/Confirm that address/i);
  });

  it('takes over one of its own confirmed extras', async () => {
    const headers = await sessionHeaders(PRIMARY);

    await auth.api.changeEmail({ body: { newEmail: EXTRA }, headers });

    const [user] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, userId));
    expect(user!.email).toBe(EXTRA);

    // The address is on the account now, so it is no longer an extra.
    const rows = await db
      .select()
      .from(schema.userEmail)
      .where(eq(schema.userEmail.userId, userId));
    expect(rows.map((row) => row.email)).toEqual([UNVERIFIED]);
  });

  it('refuses an unverified extra address', async () => {
    await expect(
      auth.api.signInEmail({
        body: { email: UNVERIFIED, password: PASSWORD },
      }),
    ).rejects.toThrow();
  });
});

describe.skipIf(!CONNECTION)('usernameForGitHubLogin', () => {
  let db: Database;
  let pool: Pool;

  beforeAll(async () => {
    ({ db, pool } = createDatabase({ connectionString: CONNECTION }));
    await migrate(db, { migrationsFolder: MIGRATIONS });
    await db.delete(schema.user).where(eq(schema.user.id, 'user_gh_spec'));
    await db
      .delete(schema.organization)
      .where(eq(schema.organization.id, 'org_gh_spec'));
    await db.insert(schema.user).values({
      id: 'user_gh_spec',
      name: 'GitHub Spec',
      email: 'gh-spec@example.com',
      username: 'gh_spec_taken',
    });
    await db.insert(schema.organization).values({
      id: 'org_gh_spec',
      name: 'GitHub Spec Org',
      slug: 'gh_spec_org',
      createdAt: new Date(),
    });
  });

  afterAll(async () => {
    await db.delete(schema.user).where(eq(schema.user.id, 'user_gh_spec'));
    await db
      .delete(schema.organization)
      .where(eq(schema.organization.id, 'org_gh_spec'));
    await pool.end();
  });

  it('turns hyphens into underscores and lowercases', async () => {
    expect(await usernameForGitHubLogin(db, 'GH-Spec-Free')).toBe(
      'gh_spec_free',
    );
  });

  it('pads a login shorter than three characters', async () => {
    expect(await usernameForGitHubLogin(db, 'x')).toBe('x__');
  });

  it('cuts a long login so a suffix still fits', async () => {
    expect(await usernameForGitHubLogin(db, 'a'.repeat(39))).toBe(
      'a'.repeat(26),
    );
  });

  it('suffixes a name a user, an organization or a route holds', async () => {
    expect(await usernameForGitHubLogin(db, 'gh-spec-taken')).toBe(
      'gh_spec_taken1',
    );
    expect(await usernameForGitHubLogin(db, 'GH-Spec-Org')).toBe(
      'gh_spec_org1',
    );
    expect(await usernameForGitHubLogin(db, 'settings')).toBe('settings1');
  });
});

describe.skipIf(!CONNECTION)('a GitHub sign-up losing its username', () => {
  const RACE_EMAILS = ['gh-race-1@example.com', 'gh-race-2@example.com'];
  let db: Database;
  let pool: Pool;
  let auth: Auth;

  const createUser = async (email: string) => {
    const { adapter } = await auth.$context;
    return adapter.create<Record<string, unknown>, { username: string }>({
      model: 'user',
      data: {
        name: 'Race',
        email,
        emailVerified: true,
        username: 'gh_race',
        displayUsername: 'gh_race',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  };

  beforeAll(async () => {
    ({ db, pool } = createDatabase({ connectionString: CONNECTION }));
    await migrate(db, { migrationsFolder: MIGRATIONS });
    auth = createAuth(db, {
      secret: 'auth-spec-secret-auth-spec-secret',
      baseURL: 'http://localhost:3001',
    });
    await db.delete(schema.user).where(inArray(schema.user.email, RACE_EMAILS));
    await db.insert(schema.user).values({
      id: 'user_gh_race',
      name: 'Race Winner',
      email: 'gh-race-winner@example.com',
      username: 'gh_race',
    });
  });

  afterAll(async () => {
    await db.delete(schema.user).where(inArray(schema.user.email, RACE_EMAILS));
    await db.delete(schema.user).where(eq(schema.user.id, 'user_gh_race'));
    await pool.end();
  });

  it('takes the next free name during the GitHub callback', async () => {
    const created = await runWithEndpointContext(
      { path: '/callback/:id' } as never,
      () => createUser(RACE_EMAILS[0]!),
    );
    expect(created.username).toBe('gh_race1');
  });

  it('leaves a conflict anywhere else to fail', async () => {
    await expect(
      runWithEndpointContext({ path: '/sign-up/email' } as never, () =>
        createUser(RACE_EMAILS[1]!),
      ),
    ).rejects.toThrow();
  });
});
