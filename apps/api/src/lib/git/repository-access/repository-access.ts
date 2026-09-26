import { schema } from '@ghost/db';
import { atLeast, organizationRoleOf, type Role } from '@ghost/permissions';
import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

import { RepositoryNotFoundError } from '../../../resources/repositories/repositories.errors.js';
import {
  AuthenticationRequiredError,
  RepositoryForbiddenError,
} from './repository-access.errors.js';

export type Repository = typeof schema.repository.$inferSelect;

/** The repository as the actor who was authorized sees it. */
export type AuthorizedRepository = Repository & { viewerRole: Role | null };

export type Actor = { userId: string } | null;

/** Each operation needs at least the role of the same name. */
export type RepositoryOperation = Exclude<Role, 'owner'>;

export type CollaboratorRole =
  (typeof schema.repositoryRole.enumValues)[number];

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

/** The `owner` in `/owner/repo`: an organization's slug for its repositories, else the owning user's username. Needs the organization left-joined on the repository. */
export function ownerNameOf(
  owner: { username: PgColumn },
  organization: { slug: PgColumn },
) {
  return sql<string>`coalesce(${organization.slug}, ${owner.username})`;
}

/** Join condition for the actor's membership of the organization whose id is `organizationId`. Matches nothing for an anonymous actor or a user's own repository. */
export function organizationMembership(
  organizationId: PgColumn,
  actor: Actor,
): SQL | undefined {
  return and(
    eq(schema.member.organizationId, organizationId),
    actor ? eq(schema.member.userId, actor.userId) : sql`false`,
  );
}

/** The highest role granted to any team the actor is in, as a scalar subquery: an actor in several teams must not multiply the outer row. Enum order is ladder order, so `max` ranks. */
export function teamRoleOf(repositoryId: PgColumn, actor: Actor) {
  if (!actor) return sql<CollaboratorRole | null>`null`;
  return sql<CollaboratorRole | null>`(select max(${schema.repositoryTeam.role}) from ${schema.repositoryTeam} inner join ${schema.teamMember} on ${schema.teamMember.teamId} = ${schema.repositoryTeam.teamId} where ${schema.repositoryTeam.repositoryId} = ${repositoryId} and ${schema.teamMember.userId} = ${actor.userId})`;
}

/** The organization's base permission for the repository's organization, as a scalar subquery; null for a user's repository or an organization that grants members nothing by default. */
export function basePermissionOf(organizationId: PgColumn) {
  return sql<CollaboratorRole | null>`(select ${schema.organizationSettings.basePermission} from ${schema.organizationSettings} where ${schema.organizationSettings.organizationId} = ${organizationId})`;
}

/** Repositories the actor holds any role on: their own, shared with them, through a team, or through an organization that gives its members access. Needs `repository_collaborator` and `member` left-joined by `acceptedCollaboration` and `organizationMembership`. */
export function grantedTo(actor: Actor) {
  return or(
    actor
      ? and(
          eq(schema.repository.ownerId, actor.userId),
          isNull(schema.repository.organizationId),
        )
      : undefined,
    isNotNull(schema.repositoryCollaborator.id),
    isNotNull(teamRoleOf(schema.repository.id, actor)),
    and(
      isNotNull(schema.member.id),
      or(
        inArray(schema.member.role, ['owner', 'admin']),
        isNotNull(basePermissionOf(schema.repository.organizationId)),
      ),
    ),
  );
}

/** Public, or granted to the actor; same joins as `grantedTo`. */
export function readableBy(actor: Actor) {
  return or(eq(schema.repository.visibility, 'public'), grantedTo(actor));
}

export type Grants = {
  collaboratorRole: CollaboratorRole | null;
  /** The highest role any of the actor's teams holds on the repository. */
  teamRole: CollaboratorRole | null;
  /** `member.role` as Better Auth stores it: one role, or several joined by commas. */
  memberRole: string | null;
  /** The organization's floor for its members; see `basePermissionOf`. */
  basePermission: CollaboratorRole | null;
};

/** A user's repository is theirs alone. An organization's is owned by the organization's owners and administered by its admins; its other members hold the base permission, raised by their teams and collaborations. The highest wins. */
export function roleOf(
  repository: Pick<Repository, 'ownerId' | 'organizationId'>,
  { collaboratorRole, memberRole, teamRole, basePermission }: Grants,
  actor: Actor,
): Role | null {
  if (!actor) return null;
  if (!repository.organizationId) {
    return repository.ownerId === actor.userId ? 'owner' : collaboratorRole;
  }

  const membership = organizationRoleOf(memberRole);
  const fromOrganization: Role | null =
    membership === 'owner'
      ? 'owner'
      : membership === 'admin'
        ? 'admin'
        : membership === 'member'
          ? basePermission
          : null;
  return highestOf([collaboratorRole, teamRole, fromOrganization]);
}

function highestOf(roles: (Role | null)[]): Role | null {
  return roles.reduce<Role | null>(
    (highest, role) =>
      role === null || atLeast(highest, role) ? highest : role,
    null,
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
