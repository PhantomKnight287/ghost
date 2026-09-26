import { Inject, Injectable } from '@nestjs/common';
import { type Database, schema } from '@ghost/db';
import { and, count, eq, gte, inArray, isNull, lt, or, sum } from 'drizzle-orm';

import {
  acceptedCollaboration,
  organizationMembership,
  readableBy,
} from '../../lib/git/repository-access/repository-access.js';
import { DATABASE } from '../../database/database.module.js';
import { UsersService } from '../../services/users/users.service.js';
import type {
  GetUserContributionsQueryDTO,
  GetUserContributionsResponseDTO,
} from './dto/contributions.dto.js';
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

    // Repositories the user created in an organization are the organization's.
    const publicRepositories = and(
      eq(schema.repository.ownerId, user.id),
      isNull(schema.repository.organizationId),
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

  /** Daily commit counts for the contribution graph, read from the index alone: rendering a profile must not materialize every repository. */
  async getContributions(
    username: string,
    query: GetUserContributionsQueryDTO = {},
    requesterId?: string,
  ): Promise<GetUserContributionsResponseDTO> {
    const user = await this.users.getUserByUsername(username);
    const now = new Date();
    const year =
      Number.isFinite(Number(query.year)) && Number(query.year) >= 2000
        ? Math.trunc(Number(query.year))
        : now.getUTCFullYear();

    const from = `${year}-01-01`;
    const to = `${year + 1}-01-01`;
    const counts = new Map<string, number>();

    // Match on the account link or on a known author email, so adding an email never needs a reindex. Commits count wherever they landed, in any repository the viewer may read.
    const emails = await this.users.listVerifiedEmails(user);
    const viewer = requesterId ? { userId: requesterId } : null;
    const rows = await this.db
      .select({
        day: schema.repositoryContribution.day,
        count: sum(schema.repositoryContribution.commits),
      })
      .from(schema.repositoryContribution)
      .innerJoin(
        schema.repository,
        eq(schema.repository.id, schema.repositoryContribution.repositoryId),
      )
      .leftJoin(
        schema.repositoryCollaborator,
        acceptedCollaboration(schema.repository.id, viewer),
      )
      .leftJoin(
        schema.member,
        organizationMembership(schema.repository.organizationId, viewer),
      )
      .where(
        and(
          readableBy(viewer),
          or(
            eq(schema.repositoryContribution.authorId, user.id),
            inArray(schema.repositoryContribution.authorEmail, emails),
          ),
          gte(schema.repositoryContribution.day, from),
          lt(schema.repositoryContribution.day, to),
        ),
      )
      .groupBy(schema.repositoryContribution.day);

    for (const row of rows) {
      counts.set(row.day, Number(row.count ?? 0));
    }

    const days: { date: string; count: number }[] = [];
    for (
      let day = new Date(Date.UTC(year, 0, 1));
      day < new Date(Date.UTC(year + 1, 0, 1));
      day = new Date(day.getTime() + 86_400_000)
    ) {
      const date = day.toISOString().slice(0, 10);
      days.push({ date, count: counts.get(date) ?? 0 });
    }

    return {
      username: user.username ?? username,
      year,
      totalContributions: days.reduce((total, d) => total + d.count, 0),
      days,
    };
  }
}
