import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, gt, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { DATABASE } from '../../database/database.module.js';
import { mailConfigured } from '../../mail/mail.module.js';
import { MailService } from '../../mail/mail.service.js';
import { UsersService } from '../../services/users/users.service.js';
import type { ListEmailsResponseDTO, UserEmailDTO } from './dto/email.dto.js';
import {
  EmailAlreadyTakenError,
  EmailNotFoundError,
  EmailNotVerifiedError,
  InvalidVerificationTokenError,
  MailNotConfiguredError,
} from './emails.errors.js';

/** Long enough that a link cannot be guessed, short enough to stay pasteable. */
const TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * Addresses an account owns beyond the one Better Auth signs it in with.
 *
 * Better Auth keys identity on `user.email` and always will; these rows sit
 * beside it and are resolved to it before its endpoints run. Nothing here
 * touches its internals - the table, the tokens and the mail are ours.
 */
@Injectable()
export class EmailsService {
  private readonly apiUrl: string;
  private readonly webAppUrl: string;
  private readonly canSendMail: boolean;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UsersService,
    private readonly mail: MailService,
    config: ConfigService,
  ) {
    this.apiUrl = config
      .getOrThrow<string>('BETTER_AUTH_URL')
      .replace(/\/+$/, '');
    this.webAppUrl = (
      config.get<string>('WEB_APP_URL') ?? 'http://localhost:3000'
    ).replace(/\/+$/, '');
    this.canSendMail = mailConfigured(config);
  }

  /** The account address first, then the extras, oldest first. */
  async list(userId: string): Promise<ListEmailsResponseDTO> {
    const [user, rows] = await Promise.all([
      this.users.getUserById(userId),
      this.db
        .select()
        .from(schema.userEmail)
        .where(eq(schema.userEmail.userId, userId))
        .orderBy(schema.userEmail.createdAt),
    ]);

    const emails: UserEmailDTO[] = [
      {
        id: 'primary',
        email: user.email,
        verified: user.emailVerified,
        primary: true,
      },
      ...rows.map((row) => ({
        id: row.id,
        email: row.email,
        verified: row.verified,
        primary: false,
      })),
    ];

    return { emails };
  }

  /**
   * Adds an address and mails it a verification link. The row exists straight
   * away but counts for nothing until the link is followed, so adding an
   * address can never claim another person's commits or sign-ins.
   */
  async add(userId: string, input: string): Promise<UserEmailDTO> {
    if (!this.canSendMail) throw new MailNotConfiguredError();

    const email = input.trim().toLowerCase();
    await this.assertAvailable(email);

    const token = nanoid(48);
    const [row] = await this.db
      .insert(schema.userEmail)
      .values({
        id: `uem_${nanoid(16)}`,
        userId,
        email,
        token,
        tokenExpiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      })
      .returning();

    const user = await this.users.getUserById(userId);
    await this.mail.sendVerifyAliasEmail(email, {
      name: user.name,
      verifyUrl: `${this.apiUrl}/api/emails/verify?token=${token}`,
    });

    return {
      id: row!.id,
      email: row!.email,
      verified: row!.verified,
      primary: false,
    };
  }

  /**
   * Confirms an address from its link. Single use: the token is cleared, so a
   * forwarded mail cannot be replayed.
   */
  async verify(token: string): Promise<{ email: string }> {
    const [row] = await this.db
      .update(schema.userEmail)
      .set({ verified: true, token: null, tokenExpiresAt: null })
      .where(
        and(
          eq(schema.userEmail.token, token),
          eq(schema.userEmail.verified, false),
          gt(schema.userEmail.tokenExpiresAt, new Date()),
        ),
      )
      .returning();

    if (!row) throw new InvalidVerificationTokenError();

    // Commits indexed before the address was known are now attributable.
    await this.db.execute(sql`
      UPDATE "repository_contribution"
      SET "author_id" = ${row.userId}
      WHERE "author_id" IS NULL
        AND "author_email" = ${row.email}
    `);

    return { email: row.email };
  }

  /**
   * Swaps a verified address with the account one. Better Auth keeps seeing
   * exactly one address; the old primary stays on the account as an extra, so
   * sign-in with it keeps working.
   */
  async makePrimary(
    userId: string,
    id: string,
  ): Promise<ListEmailsResponseDTO> {
    const row = await this.own(userId, id);
    if (!row.verified) throw new EmailNotVerifiedError(row.email);

    const user = await this.users.getUserById(userId);

    await this.db.transaction(async (tx) => {
      await tx.delete(schema.userEmail).where(eq(schema.userEmail.id, row.id));
      await tx.insert(schema.userEmail).values({
        id: `uem_${nanoid(16)}`,
        userId,
        email: user.email.toLowerCase(),
        verified: user.emailVerified,
      });
      await tx
        .update(schema.user)
        .set({ email: row.email, emailVerified: true })
        .where(eq(schema.user.id, userId));
    });

    return this.list(userId);
  }

  async remove(userId: string, id: string): Promise<void> {
    const row = await this.own(userId, id);
    await this.db
      .delete(schema.userEmail)
      .where(eq(schema.userEmail.id, row.id));
  }

  /** Where a verification link sends the browser once it has been followed. */
  settingsUrl(status: 'verified' | 'invalid'): string {
    return `${this.webAppUrl}/settings/account?email=${status}`;
  }

  private async own(userId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(schema.userEmail)
      .where(
        and(eq(schema.userEmail.id, id), eq(schema.userEmail.userId, userId)),
      );
    if (!row) throw new EmailNotFoundError();
    return row;
  }

  /** An address belongs to one account only, primary or extra. */
  private async assertAvailable(email: string) {
    const [[takenAsPrimary], [takenAsExtra]] = await Promise.all([
      this.db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(sql`lower(${schema.user.email})`, email)),
      this.db
        .select({ id: schema.userEmail.id })
        .from(schema.userEmail)
        .where(eq(schema.userEmail.email, email)),
    ]);

    if (takenAsPrimary || takenAsExtra) throw new EmailAlreadyTakenError(email);
  }
}
