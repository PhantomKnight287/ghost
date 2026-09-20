import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DATABASE } from '../../database/database.module.js';
import { UserNotFoundError } from './users.errors.js';

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

  /**
   * Every address that resolves to an account: the one Better Auth signs it in
   * with, plus the verified extras. Unverified rows are left out - they are
   * claims, not proof.
   */
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

  async getUserByUsername(username: string) {
    const [user] = await this.database
      .select()
      .from(schema.user)
      .where(eq(schema.user.username, username));
    if (!user) throw new UserNotFoundError(username);
    return user;
  }
}
