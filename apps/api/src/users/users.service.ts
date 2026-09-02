import { Inject, Injectable } from '@nestjs/common';
import { eq, users, type Database, type NewUser } from '@ghost/db';

import { DATABASE } from '../database/database.module.js';

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  findAll() {
    return this.db.select().from(users);
  }

  async findOne(id: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, id));
    return user ?? null;
  }

  async create(input: NewUser) {
    const [user] = await this.db.insert(users).values(input).returning();
    return user;
  }
}
