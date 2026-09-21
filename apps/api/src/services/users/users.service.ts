import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DATABASE } from '../../database/database.module.js';
import { UserNotFoundError } from '../../lib/users/users.errors.js';

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async getUserById(userId: string) {
    const [user] = await this.database
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, userId));
    if (!user) throw new UserNotFoundError(userId);
    return user;
  }

  /** Every address that resolves to an account: the one Better Auth signs it in with, plus the verified extras. Unverified rows are left out - they are claims, not proof. */
  async listVerifiedEmails(user: { id: string; email: string }) {
    const rows = await this.database
      .select({ email: schema.userEmail.email })
      .from(schema.userEmail)
      .where(
        and(
          eq(schema.userEmail.userId, user.id),
          eq(schema.userEmail.verified, true),
        ),
      );
    return [user.email.toLowerCase(), ...rows.map((row) => row.email)];
  }

  /** {@link listVerifiedEmails} for several accounts at once, keyed by user id. */
  async verifiedEmailsByUser(
    userIds: string[],
  ): Promise<Map<string, string[]>> {
    const wanted = [...new Set(userIds)];
    const byUser = new Map<string, string[]>();
    if (wanted.length === 0) return byUser;

    const [users, extras] = await Promise.all([
      this.database
        .select({ id: schema.user.id, email: schema.user.email })
        .from(schema.user)
        .where(inArray(schema.user.id, wanted)),
      this.database
        .select({
          userId: schema.userEmail.userId,
          email: schema.userEmail.email,
        })
        .from(schema.userEmail)
        .where(
          and(
            inArray(schema.userEmail.userId, wanted),
            eq(schema.userEmail.verified, true),
          ),
        ),
    ]);

    for (const user of users) {
      byUser.set(user.id, [user.email.toLowerCase()]);
    }
    for (const extra of extras) {
      byUser.get(extra.userId)?.push(extra.email);
    }

    return byUser;
  }

  async getUserByUsername(username: string) {
    const [user] = await this.database
      .select()
      .from(schema.user)
      .where(eq(schema.user.username, username));
    if (!user) throw new UserNotFoundError(username);
    return user;
  }
}
