import path from 'node:path';
import { createDatabase, type Database, type Pool, schema } from '@ghost/db';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { DATABASE } from '../../database/database.module.js';
import { MailService } from '../../mail/mail.service.js';
import { UsersService } from '../../services/users/users.service.js';
import {
  EmailAlreadyTakenError,
  EmailAlreadyVerifiedError,
  EmailNotVerifiedError,
  InvalidVerificationTokenError,
  ResendTooSoonError,
} from './emails.errors.js';
import { EmailsService } from './emails.service.js';

const CONNECTION = process.env.TEST_DATABASE_URL;
const MIGRATIONS = path.resolve(
  import.meta.dirname,
  '../../../../../packages/db/drizzle',
);

const USER_ID = 'user_emails_spec';
const PRIMARY = 'emails-spec@example.com';

const config = {
  get: (key: string) =>
    ({
      WEB_APP_URL: 'http://localhost:3000',
      EMAIL_PROXY: 'https://relay.test',
    })[key],
  getOrThrow: (key: string) =>
    ({ BETTER_AUTH_URL: 'http://localhost:3001' })[key],
} as unknown as ConfigService;

// Needs a throwaway Postgres; the suite is skipped without one.
describe.skipIf(!CONNECTION)('EmailsService', () => {
  let db: Database;
  let pool: Pool;
  let service: EmailsService;
  const mail = { sendVerifyAliasEmail: vi.fn() };

  /** The token only ever leaves the row through the mail, so read it back. */
  async function tokenFor(email: string) {
    const [row] = await db
      .select()
      .from(schema.userEmail)
      .where(eq(schema.userEmail.email, email));
    return row!.token!;
  }

  /** Pushes a row's token past the resend throttle. */
  async function ageToken(email: string) {
    await db
      .update(schema.userEmail)
      .set({ tokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000) })
      .where(eq(schema.userEmail.email, email));
  }

  beforeAll(async () => {
    ({ db, pool } = createDatabase({ connectionString: CONNECTION }));
    await migrate(db, { migrationsFolder: MIGRATIONS });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailsService,
        UsersService,
        { provide: DATABASE, useValue: db },
        { provide: MailService, useValue: mail },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(EmailsService);
  });

  afterAll(async () => {
    await db.delete(schema.user).where(eq(schema.user.id, USER_ID));
    await pool.end();
  });

  beforeEach(async () => {
    mail.sendVerifyAliasEmail.mockReset();
    await db.delete(schema.user).where(eq(schema.user.id, USER_ID));
    await db.insert(schema.user).values({
      id: USER_ID,
      name: 'Spec',
      email: PRIMARY,
      emailVerified: true,
    });
  });

  it('adds an address unverified and mails it a link', async () => {
    const added = await service.add(USER_ID, 'Extra@Example.com');

    expect(added.email).toBe('extra@example.com');
    expect(added.verified).toBe(false);

    const [to, context] = mail.sendVerifyAliasEmail.mock.calls[0];
    expect(to).toBe('extra@example.com');
    expect(context.verifyUrl).toContain(
      'http://localhost:3001/api/emails/verify?token=',
    );
  });

  it('refuses an address another account already holds', async () => {
    await expect(service.add(USER_ID, PRIMARY)).rejects.toBeInstanceOf(
      EmailAlreadyTakenError,
    );

    await service.add(USER_ID, 'taken@example.com');
    await expect(
      service.add(USER_ID, 'taken@example.com'),
    ).rejects.toBeInstanceOf(EmailAlreadyTakenError);
  });

  it('verifies once and rejects a replayed link', async () => {
    await service.add(USER_ID, 'confirm@example.com');
    const token = await tokenFor('confirm@example.com');

    await expect(service.verify(token)).resolves.toEqual({
      email: 'confirm@example.com',
    });

    const { emails } = await service.list(USER_ID);
    expect(
      emails.find((e) => e.email === 'confirm@example.com')?.verified,
    ).toBe(true);

    await expect(service.verify(token)).rejects.toBeInstanceOf(
      InvalidVerificationTokenError,
    );
  });

  it('attributes commits already indexed under the address', async () => {
    const [repository] = await db
      .insert(schema.repository)
      .values({
        name: 'spec',
        slug: `emails-spec-${Date.now()}`,
        ownerId: USER_ID,
      })
      .returning();

    await db.insert(schema.repositoryContribution).values({
      repositoryId: repository!.id,
      authorEmail: 'old-laptop@example.com',
      authorName: 'Spec',
      day: '2026-03-02',
      commits: 3,
    });

    await service.add(USER_ID, 'old-laptop@example.com');
    await service.verify(await tokenFor('old-laptop@example.com'));

    const [row] = await db
      .select()
      .from(schema.repositoryContribution)
      .where(eq(schema.repositoryContribution.repositoryId, repository!.id));
    expect(row!.authorId).toBe(USER_ID);
  });

  it('resends a fresh link and retires the old one', async () => {
    await service.add(USER_ID, 'again@example.com');
    const first = await tokenFor('again@example.com');
    const { id } = (await service.list(USER_ID)).emails.find(
      (entry) => entry.email === 'again@example.com',
    )!;

    // The throttle reads the stored expiry, so age the row instead of waiting.
    await ageToken('again@example.com');
    await service.resend(USER_ID, id);

    const second = await tokenFor('again@example.com');
    expect(second).not.toBe(first);
    expect(mail.sendVerifyAliasEmail).toHaveBeenCalledTimes(2);

    // The link that was replaced is dead.
    await expect(service.verify(first)).rejects.toBeInstanceOf(
      InvalidVerificationTokenError,
    );
    await expect(service.verify(second)).resolves.toEqual({
      email: 'again@example.com',
    });
  });

  it('refuses a resend straight after the last one', async () => {
    await service.add(USER_ID, 'slowdown@example.com');
    const { id } = (await service.list(USER_ID)).emails.find(
      (entry) => entry.email === 'slowdown@example.com',
    )!;

    await expect(service.resend(USER_ID, id)).rejects.toBeInstanceOf(
      ResendTooSoonError,
    );
  });

  it('refuses a resend for an address already verified', async () => {
    await service.add(USER_ID, 'done@example.com');
    const { id } = (await service.list(USER_ID)).emails.find(
      (entry) => entry.email === 'done@example.com',
    )!;
    await service.verify(await tokenFor('done@example.com'));

    await expect(service.resend(USER_ID, id)).rejects.toBeInstanceOf(
      EmailAlreadyVerifiedError,
    );
  });

  it('swaps a verified address with the primary, keeping the old one', async () => {
    await service.add(USER_ID, 'next@example.com');
    const added = (await service.list(USER_ID)).emails.find(
      (e) => e.email === 'next@example.com',
    )!;

    await expect(service.makePrimary(USER_ID, added.id)).rejects.toBeInstanceOf(
      EmailNotVerifiedError,
    );

    await service.verify(await tokenFor('next@example.com'));
    const { emails } = await service.makePrimary(USER_ID, added.id);

    expect(emails[0]).toMatchObject({
      email: 'next@example.com',
      primary: true,
      verified: true,
    });
    // The old primary stays on the account, so sign-in with it keeps working.
    expect(emails.slice(1)).toEqual([
      expect.objectContaining({ email: PRIMARY, verified: true }),
    ]);
  });

  it('removes an address', async () => {
    await service.add(USER_ID, 'gone@example.com');
    const added = (await service.list(USER_ID)).emails.find(
      (e) => e.email === 'gone@example.com',
    )!;

    await service.remove(USER_ID, added.id);

    const { emails } = await service.list(USER_ID);
    expect(emails).toHaveLength(1);
    expect(emails[0].primary).toBe(true);
  });
});
