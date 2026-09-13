import { Inject, Injectable } from '@nestjs/common';
import { type Database, schema } from '@ghost/db';
import { and, count, eq } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { UsersService } from '../../services/users/users.service.js';
import type { UserProfileResponseDTO } from './dto/profile.dto.js';

@Injectable()
export class UserService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UsersService,
  ) {}

  /** The public profile: anything a signed-out visitor may see. */
  async getProfile(username: string): Promise<UserProfileResponseDTO> {
    const user = await this.users.getUserByUsername(username);

    const publicRepositories = and(
      eq(schema.repository.ownerId, user.id),
      eq(schema.repository.visibility, 'public'),
    );

    const [[repositories], [stars]] = await Promise.all([
      this.db
        .select({ value: count() })
        .from(schema.repository)
        .where(publicRepositories),
      this.db
        .select({ value: count() })
        .from(schema.stars)
        .innerJoin(
          schema.repository,
          eq(schema.repository.id, schema.stars.repositoryId),
        )
        .where(publicRepositories),
    ]);

    return {
      username: user.username ?? username,
      name: user.name,
      image: user.image,
      joinedAt: user.createdAt.toISOString(),
      repositoryCount: repositories?.value ?? 0,
      starCount: stars?.value ?? 0,
    };
  }
}
