import path from 'node:path';
import { createDatabase, type Database, type Pool, schema } from '@ghost/db';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DATABASE } from '../../database/database.module.js';
import {
  SIGNING_KEY_ID,
  SIGNING_PUBLIC_KEY,
} from '../../services/gpg/__fixtures__/signed-commit.js';
import { UsersService } from '../../services/users/users.service.js';
import {
  GpgKeyAlreadyExistsError,
  GpgKeyEmailNotVerifiedError,
  GpgKeyNotFoundError,
  InvalidGpgKeyError,
} from './gpg-keys.errors.js';
import { GpgKeysService } from './gpg-keys.service.js';

const CONNECTION = process.env.TEST_DATABASE_URL;
const MIGRATIONS = path.resolve(
  import.meta.dirname,
  '../../../../../packages/db/drizzle',
);

const USER_ID = 'user_gpg_keys_spec';
const OTHER_ID = 'user_gpg_keys_spec_other';
const KEY_EMAIL = 'test@ghost.local';

// Needs a throwaway Postgres; the suite is skipped without one.
describe.skipIf(!CONNECTION)('GpgKeysService', () => {
  let db: Database;
  let pool: Pool;
  let service: GpgKeysService;

  beforeAll(async () => {
    ({ db, pool } = createDatabase({ connectionString: CONNECTION }));
    await migrate(db, { migrationsFolder: MIGRATIONS });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GpgKeysService,
        UsersService,
        { provide: DATABASE, useValue: db },
      ],
    }).compile();
    service = module.get(GpgKeysService);
  });

  afterAll(async () => {
    await db.delete(schema.user).where(eq(schema.user.id, USER_ID));
    await db.delete(schema.user).where(eq(schema.user.id, OTHER_ID));
    await pool.end();
  });

  beforeEach(async () => {
    await db.delete(schema.user).where(eq(schema.user.id, USER_ID));
    await db.delete(schema.user).where(eq(schema.user.id, OTHER_ID));
    await db.insert(schema.user).values([
      { id: USER_ID, name: 'Spec', email: KEY_EMAIL, emailVerified: true },
      {
        id: OTHER_ID,
        name: 'Other',
        email: 'other@example.com',
        emailVerified: true,
      },
    ]);
  });

  it('adds a key that carries an address the account owns', async () => {
    const added = await service.add(USER_ID, SIGNING_PUBLIC_KEY);

    expect(added.keyId).toBe(SIGNING_KEY_ID);
    expect(added.emails).toContain(KEY_EMAIL);
    expect((await service.list(USER_ID)).keys).toHaveLength(1);
  });

  it('refuses a key whose addresses the account has not verified', async () => {
    await expect(service.add(OTHER_ID, SIGNING_PUBLIC_KEY)).rejects.toThrow(
      GpgKeyEmailNotVerifiedError,
    );
  });

  it('accepts a key matching a verified extra address', async () => {
    await db
      .update(schema.user)
      .set({ email: 'moved@example.com' })
      .where(eq(schema.user.id, USER_ID));
    await db.insert(schema.userEmail).values({
      id: 'uem_gpg_spec',
      userId: USER_ID,
      email: KEY_EMAIL,
      verified: true,
    });

    await expect(
      service.add(USER_ID, SIGNING_PUBLIC_KEY),
    ).resolves.toMatchObject({ keyId: SIGNING_KEY_ID });
  });

  it('refuses a key matching an address that is only claimed', async () => {
    await db
      .update(schema.user)
      .set({ email: 'moved2@example.com' })
      .where(eq(schema.user.id, USER_ID));
    await db.insert(schema.userEmail).values({
      id: 'uem_gpg_spec_2',
      userId: USER_ID,
      email: KEY_EMAIL,
      verified: false,
    });

    await expect(service.add(USER_ID, SIGNING_PUBLIC_KEY)).rejects.toThrow(
      GpgKeyEmailNotVerifiedError,
    );
  });

  it('refuses armor that is not a public key', async () => {
    await expect(service.add(USER_ID, 'not a key')).rejects.toThrow(
      InvalidGpgKeyError,
    );
  });

  it('refuses a key that already belongs to an account', async () => {
    await service.add(USER_ID, SIGNING_PUBLIC_KEY);

    await expect(service.add(USER_ID, SIGNING_PUBLIC_KEY)).rejects.toThrow(
      GpgKeyAlreadyExistsError,
    );
  });

  it('removes only the keys of the account that asks', async () => {
    const added = await service.add(USER_ID, SIGNING_PUBLIC_KEY);

    await expect(service.remove(OTHER_ID, added.id)).rejects.toThrow(
      GpgKeyNotFoundError,
    );

    await service.remove(USER_ID, added.id);
    expect((await service.list(USER_ID)).keys).toHaveLength(0);
  });
});
