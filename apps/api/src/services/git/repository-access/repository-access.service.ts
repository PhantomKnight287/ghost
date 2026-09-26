import { Inject, Injectable } from '@nestjs/common';
import { type Database, schema } from '@ghost/db';
import { and, eq, isNotNull, type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

import { DATABASE } from '../../../database/database.module.js';
import { RepositoryNotFoundError } from '../../../resources/repositories/repositories.errors.js';
import {
  AuthenticationRequiredError,
  RepositoryForbiddenError,
} from '../../../lib/git/repository-access/repository-access.errors.js';
import { type Role, roleHierarchy } from '../../../lib/permissions.js';

export type Repository = typeof schema.repository.$inferSelect;

/** The repository as the actor who was authorized sees it. */
export type AuthorizedRepository = Repository & { viewerRole: Role | null };

export type Actor = { userId: string } | null;

/** Each operation needs at least the role of the same name. */
export type RepositoryOperation = Exclude<Role, 'owner'>;

export type CollaboratorRole =
  (typeof schema.repositoryRole.enumValues)[number];

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
  }): Promise<AuthorizedRepository> {
    const [row] = await this.database
      .select({
        repository: schema.repository,
        collaboratorRole: schema.repositoryCollaborator.role,
      })
      .from(schema.repository)
      .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
      .leftJoin(
        schema.repositoryCollaborator,
        acceptedCollaboration(schema.repository.id, actor),
      )
      .where(
        and(
          eq(schema.user.username, username),
          eq(schema.repository.slug, repo),
        ),
      )
      .limit(1);

    const repository = row?.repository ?? null;
    return decideAccess(
      repository,
      repository && roleOf(repository, row.collaboratorRole, actor),
      actor,
      operation,
    );
  }
}

/** Join condition for the actor's accepted collaboration on the repository whose id is `repositoryId`. Matches nothing for an anonymous actor. */
export function acceptedCollaboration(
  repositoryId: PgColumn,
  actor: Actor,
): SQL | undefined {
  return and(
    eq(schema.repositoryCollaborator.repositoryId, repositoryId),
    actor ? eq(schema.repositoryCollaborator.userId, actor.userId) : sql`false`,
    isNotNull(schema.repositoryCollaborator.acceptedAt),
  );
}

export function roleOf(
  repository: Pick<Repository, 'ownerId'>,
  collaboratorRole: CollaboratorRole | null,
  actor: Actor,
): Role | null {
  if (!actor) return null;
  return repository.ownerId === actor.userId ? 'owner' : collaboratorRole;
}

export function atLeast(role: Role | null, needed: Role) {
  return (
    role !== null &&
    roleHierarchy.indexOf(role) >= roleHierarchy.indexOf(needed)
  );
}

export function canAccess(
  repository: Pick<Repository, 'visibility'> | null,
  role: Role | null,
  operation: RepositoryOperation,
) {
  if (!repository) return false;
  if (operation === 'read' && repository.visibility === 'public') return true;
  return atLeast(role, operation);
}

export function decideAccess(
  repository: Repository | null,
  role: Role | null,
  actor: Actor,
  operation: RepositoryOperation,
): AuthorizedRepository {
  if (repository && canAccess(repository, role, operation)) {
    return { ...repository, viewerRole: role };
  }
  if (!actor) throw new AuthenticationRequiredError();
  // An unreadable repository must look absent; a readable one is safe to admit to.
  if (canAccess(repository, role, 'read')) throw new RepositoryForbiddenError();
  throw new RepositoryNotFoundError();
}
