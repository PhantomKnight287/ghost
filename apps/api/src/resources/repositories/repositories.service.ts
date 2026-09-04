import { Inject, Injectable } from '@nestjs/common';
import { type Database, schema } from '@ghost/db';
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { CreateRepositoryRequestDTO } from './dto/create-repository.dto.js';
import { GetRepositoriesQueryDTO } from './dto/get-repositories.dto.js';
import { UsersService } from '../../services/users/users.service.js';
import {
  InvalidCursorError,
  RepositoryNotFoundError,
} from './repositories.errors.js';
import { decodeCursor, encodeCursor, titleToSlug } from '../../utils/index.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class RepositoriesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly usersService: UsersService,
  ) {}

  async createRepository(body: CreateRepositoryRequestDTO, userId: string) {
    const user = await this.usersService.getUserById(userId);
    const { slugified, slugifiedWithSuffix } = titleToSlug(body.name);
    let slug = slugified;
    try {
      await this.getRepositoryBySlug({ ownerId: user.id, slug: slugified });
      slug = slugifiedWithSuffix;
    } catch (_) {
      // we discard the error cus its of instance [RepositoryNotFoundError]
      slug = slugified;
    }

    const [newRepo] = await this.db
      .insert(schema.repository)
      .values({
        name: body.name,
        ownerId: user.id,
        slug,
        description: body.description,
      })
      .returning();

    return {
      id: newRepo.id,
      slug: newRepo.slug,
    };
  }

  async getRepositories(
    username: string,
    requesterId?: string,
    query: GetRepositoriesQueryDTO = {},
  ) {
    const user = await this.usersService.getUserByUsername(username);
    return this.getUserRepositories({
      userId: user.id,
      cursor: query.cursor,
      limit: query.limit,
      includePrivate: user.id === requesterId,
    });
  }

  async getRepositoryBySlug({
    ownerId,
    slug,
  }: {
    ownerId: string;
    slug: string;
  }) {
    const [repository] = await this.db
      .select()
      .from(schema.repository)
      .where(
        and(
          eq(schema.repository.ownerId, ownerId),
          eq(schema.repository.slug, slug.toLowerCase()),
        ),
      );
    if (!repository) {
      throw new RepositoryNotFoundError();
    }
    return repository;
  }

  async getRepository({
    username,
    slug,
    requesterId,
  }: {
    username: string;
    slug: string;
    requesterId?: string;
  }) {
    const owner = await this.usersService.getUserByUsername(username);
    const repository = await this.getRepositoryBySlug({
      ownerId: owner.id,
      slug,
    });

    if (repository.visibility === 'private' && owner.id !== requesterId) {
      throw new RepositoryNotFoundError();
    }

    return repository;
  }

  private async getUserRepositories({
    cursor,
    includePrivate = false,
    limit = DEFAULT_PAGE_SIZE,
    userId,
  }: {
    userId: string;
    cursor?: string;
    limit?: number;
    includePrivate?: boolean;
  }) {
    const requested = Number(limit);
    const pageSize = Number.isFinite(requested)
      ? Math.min(Math.max(Math.trunc(requested), 1), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) {
      throw new InvalidCursorError();
    }

    // Keyset predicate matching the (lastPushedAt, id) ordering below. `id`
    // breaks ties so repos sharing a lastPushedAt are never skipped or repeated.
    const after = decoded
      ? or(
          lt(schema.repository.lastPushedAt, decoded.date),
          and(
            eq(schema.repository.lastPushedAt, decoded.date),
            lt(schema.repository.id, decoded.id),
          ),
        )
      : undefined;

    const rows = await this.db
      .select()
      .from(schema.repository)
      .where(
        and(
          eq(schema.repository.ownerId, userId),
          inArray(
            schema.repository.visibility,
            includePrivate ? ['private', 'public'] : ['public'],
          ),
          after,
        ),
      )
      .orderBy(desc(schema.repository.lastPushedAt), desc(schema.repository.id))
      // one extra row tells us whether another page exists
      .limit(pageSize + 1);

    const hasMore = rows.length > pageSize;
    const repositories = hasMore ? rows.slice(0, pageSize) : rows;
    const last = repositories.at(-1);

    return {
      repositories,
      nextCursor:
        hasMore && last
          ? encodeCursor({ date: last.lastPushedAt, id: last.id })
          : null,
      hasMore,
    };
  }
}
