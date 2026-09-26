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
    const lookup = (where: SQL | undefined) =>
      this.database
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

    let [row] = await lookup(
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
        [row] = await lookup(eq(schema.repository.id, redirect.repositoryId));
      }
    }

    const repository = row?.repository ?? null;
    return decideAccess(
      repository,
      repository && roleOf(repository, row, actor),
      actor,
      operation,
    );
  }
}
