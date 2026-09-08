import { Inject, Injectable } from '@nestjs/common';
import { type Database, schema } from '@ghost/db';
import { and, eq } from 'drizzle-orm';

import { DATABASE } from '../../../database/database.module.js';
import { RepositoryNotFoundError } from '../../../resources/repositories/repositories.errors.js';
import {
  AuthenticationRequiredError,
  RepositoryForbiddenError,
} from './repository-access.errors.js';

export type Repository = typeof schema.repository.$inferSelect;

export type Actor = { userId: string } | null;

export type RepositoryOperation = 'read' | 'write';

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

export function decideAccess(
  repository: Repository | null,
  actor: Actor,
  operation: RepositoryOperation,
): Repository {
  const isOwner = actor !== null && repository?.ownerId === actor.userId;
  const readable = repository?.visibility === 'public' || isOwner;
  const allowed = operation === 'read' ? readable : isOwner;

  if (allowed) return repository as Repository;
  if (!actor) throw new AuthenticationRequiredError();
  // An unreadable repository must look absent; a readable one is safe to admit to.
  if (readable && operation === 'write') throw new RepositoryForbiddenError();
  throw new RepositoryNotFoundError();
}
