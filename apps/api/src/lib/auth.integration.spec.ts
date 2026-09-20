import path from 'node:path';
import { createDatabase, type Database, type Pool, schema } from '@ghost/db';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Auth, createAuth } from './auth.js';

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

    // And another account's verified extra, which Better Auth alone would
    // happily hand over.
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
