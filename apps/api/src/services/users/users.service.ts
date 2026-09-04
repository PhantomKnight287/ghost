import { Inject, Injectable } from '@nestjs/common';
import { DATABASE } from '../../database/database.module.js';
import { schema, type Database } from '@ghost/db';
import { eq } from 'drizzle-orm';
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

  async getUserByUsername(username: string) {
    const [user] = await this.database
      .select()
      .from(schema.user)
      .where(eq(schema.user.username, username));
    if (!user) throw new UserNotFoundError(username);
    return user;
  }
}
