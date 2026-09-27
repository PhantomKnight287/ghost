import { Inject, Injectable } from '@nestjs/common';
import { type Database, schema } from '@ghost/db';
import { and, eq, type SQL, sql } from 'drizzle-orm';

import { DATABASE } from '../../../database/database.module.js';
import {
  acceptedCollaboration,
  type Actor,
  type AuthorizedRepository,
  basePermissionOf,
  decideAccess,
  organizationMembership,
  ownerNameOf,
  type RepositoryOperation,
  roleOf,
  teamRoleOf,
} from '../../../lib/git/repository-access/repository-access.js';

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
    let [row] = await this.lookup(
      actor,
      and(
        eq(ownerNameOf(schema.user, schema.organization), username),
        eq(schema.repository.slug, repo),
      ),
    );
    // A renamed or transferred repository is still reachable at its old name, as long as nothing took that name since.
    if (!row) {
      const [redirect] = await this.database
        .select({ repositoryId: schema.repositoryRedirect.repositoryId })
        .from(schema.repositoryRedirect)
        .where(
          and(
            eq(
              sql`lower(${schema.repositoryRedirect.ownerName})`,
              username.toLowerCase(),
            ),
            eq(schema.repositoryRedirect.slug, repo),
          ),
        );
      if (redirect) {
        [row] = await this.lookup(
          actor,
          eq(schema.repository.id, redirect.repositoryId),
        );
      }
    }
    return this.decide(row, actor, operation);
  }

  /** For a repository known by row id, such as the other side of a pull request. */
  async authorizeById({
    repositoryId,
    actor,
    operation,
  }: {
    repositoryId: string;
    actor: Actor;
    operation: RepositoryOperation;
  }): Promise<AuthorizedRepository> {
    const [row] = await this.lookup(
      actor,
      eq(schema.repository.id, repositoryId),
    );
    return this.decide(row, actor, operation);
  }

  private lookup(actor: Actor, where: SQL | undefined) {
    return this.database
      .select({
        repository: schema.repository,
        collaboratorRole: schema.repositoryCollaborator.role,
        memberRole: schema.member.role,
        teamRole: teamRoleOf(schema.repository.id, actor),
        basePermission: basePermissionOf(schema.repository.organizationId),
      })
      .from(schema.repository)
      .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
      .leftJoin(
        schema.organization,
        eq(schema.organization.id, schema.repository.organizationId),
      )
      .leftJoin(
        schema.repositoryCollaborator,
        acceptedCollaboration(schema.repository.id, actor),
      )
      .leftJoin(
        schema.member,
        organizationMembership(schema.repository.organizationId, actor),
      )
      .where(where)
      .limit(1);
  }

  private decide(
    row:
      | Awaited<ReturnType<RepositoryAccessService['lookup']>>[number]
      | undefined,
    actor: Actor,
    operation: RepositoryOperation,
  ) {
    return decideAccess(
      row?.repository ?? null,
      row ? roleOf(row.repository, row, actor) : null,
      actor,
      operation,
    );
  }
}
