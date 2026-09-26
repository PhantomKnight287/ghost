import { Inject, Injectable } from '@nestjs/common';
import { type Database, schema } from '@ghost/db';
import { and, eq } from 'drizzle-orm';

import { DATABASE } from '../../../database/database.module.js';
import { RepositoryNotFoundError } from '../../../resources/repositories/repositories.errors.js';
import {
  AuthenticationRequiredError,
  RepositoryForbiddenError,
} from '../../../lib/git/repository-access/repository-access.errors.js';

export type Repository = typeof schema.repository.$inferSelect;

export type Actor = { userId: string } | null;

// `admin` is settings and deletion. Only the owner holds it until collaborators land, so it resolves like `write` for now.
export type RepositoryOperation = 'read' | 'write' | 'admin';

@Injectable()
export class RepositoryAccessService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async authorize({
    username,
    repo,
    actor,
    operation,
  }: {
    username: string;
    repo: string;
    actor: Actor;
    operation: RepositoryOperation;
  }): Promise<Repository> {
    const [row] = await this.database
      .select({ repository: schema.repository })
      .from(schema.repository)
      .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
      .where(
        and(
          eq(schema.user.username, username),
          eq(schema.repository.slug, repo),
        ),
      )
      .limit(1);

    const repository = decideAccess(row?.repository ?? null, actor, operation);
    return repository;
  }
}

export function canAccess(
  repository: Pick<Repository, 'ownerId' | 'visibility'> | null,
  actor: Actor,
  operation: RepositoryOperation,
) {
  const isOwner = actor !== null && repository?.ownerId === actor.userId;
  const readable = repository?.visibility === 'public' || isOwner;
  return operation === 'read' ? readable : isOwner;
}

export function decideAccess(
  repository: Repository | null,
  actor: Actor,
  operation: RepositoryOperation,
): Repository {
  const readable = canAccess(repository, actor, 'read');

  if (canAccess(repository, actor, operation)) return repository as Repository;
  if (!actor) throw new AuthenticationRequiredError();
  // An unreadable repository must look absent; a readable one is safe to admit to.
  if (readable) throw new RepositoryForbiddenError();
  throw new RepositoryNotFoundError();
}
