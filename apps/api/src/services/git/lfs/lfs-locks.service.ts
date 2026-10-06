import { type Database, schema } from '@ghost/db';
import { atLeast } from '@ghost/permissions';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, type SQL, sql } from 'drizzle-orm';

import { DATABASE } from '../../../database/database.module.js';
import {
  LfsLockForbiddenError,
  LfsLockNotFoundError,
} from '../../../lib/git/lfs/lfs.errors.js';
import type { AuthorizedRepository } from '../../../lib/git/repository-access/repository-access.js';
import { isoTimestamp } from '../../../utils/index.js';

const DEFAULT_PAGE = 100;

const lockColumns = {
  id: schema.lfsLock.id,
  path: schema.lfsLock.path,
  locked_at: isoTimestamp(schema.lfsLock.createdAt),
  owner: {
    name: sql<string>`coalesce(${schema.user.username}, ${schema.user.name})`,
  },
};

/** Git LFS's file locking API. Locks are advisory: git-lfs checks them before a push, the server does not. */
@Injectable()
export class LfsLocksService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** The new lock, or with `created` false the one already holding the path. */
  async create(repositoryId: string, ownerId: string, path: string) {
    const [created] = await this.db
      .insert(schema.lfsLock)
      .values({ repositoryId, path, ownerId })
      .onConflictDoNothing()
      .returning({ id: schema.lfsLock.id });
    const [lock] = await this.select(
      and(
        eq(schema.lfsLock.repositoryId, repositoryId),
        eq(schema.lfsLock.path, path),
      ),
    );
    // the holder unlocked between the conflict and the read
    if (!lock) throw new LfsLockNotFoundError();
    return { lock, created: Boolean(created) };
  }

  /** Ordered by path, which is unique per repository and so serves as the cursor. */
  async list(
    repositoryId: string,
    {
      path,
      id,
      cursor,
      limit = DEFAULT_PAGE,
    }: { path?: string; id?: string; cursor?: string; limit?: number },
  ) {
    const rows = await this.select(
      and(
        eq(schema.lfsLock.repositoryId, repositoryId),
        path === undefined ? undefined : eq(schema.lfsLock.path, path),
        id === undefined ? undefined : eq(schema.lfsLock.id, id),
        cursor === undefined ? undefined : gt(schema.lfsLock.path, cursor),
      ),
    )
      .orderBy(asc(schema.lfsLock.path))
      .limit(limit + 1);
    const locks = rows.slice(0, limit);
    return {
      locks,
      next_cursor: rows.length > limit ? (locks.at(-1)?.path ?? null) : null,
    };
  }

  /** What git-lfs asks before a push: the locks the pusher holds, and everyone else's. */
  async verify(
    repositoryId: string,
    userId: string,
    page: { cursor?: string; limit?: number },
  ) {
    const { locks, next_cursor } = await this.list(repositoryId, page);
    const owned = await this.db
      .select({ id: schema.lfsLock.id })
      .from(schema.lfsLock)
      .where(
        and(
          eq(schema.lfsLock.repositoryId, repositoryId),
          eq(schema.lfsLock.ownerId, userId),
        ),
      );
    const ours = new Set(owned.map(({ id }) => id));
    return {
      ours: locks.filter(({ id }) => ours.has(id)),
      theirs: locks.filter(({ id }) => !ours.has(id)),
      next_cursor,
    };
  }

  /** Only the owner may unlock, or an admin who forces it. */
  async unlock(
    repository: AuthorizedRepository,
    userId: string,
    id: string,
    force = false,
  ) {
    const [held] = await this.db
      .select({ ownerId: schema.lfsLock.ownerId })
      .from(schema.lfsLock)
      .where(
        and(
          eq(schema.lfsLock.id, id),
          eq(schema.lfsLock.repositoryId, repository.id),
        ),
      );
    if (!held) throw new LfsLockNotFoundError();
    if (
      held.ownerId !== userId &&
      !(force && atLeast(repository.viewerRole, 'admin'))
    ) {
      throw new LfsLockForbiddenError();
    }

    const [lock] = await this.select(eq(schema.lfsLock.id, id));
    await this.db.delete(schema.lfsLock).where(eq(schema.lfsLock.id, id));
    return { lock };
  }

  private select(where: SQL | undefined) {
    return this.db
      .select(lockColumns)
      .from(schema.lfsLock)
      .innerJoin(schema.user, eq(schema.user.id, schema.lfsLock.ownerId))
      .where(where)
      .$dynamic();
  }
}
