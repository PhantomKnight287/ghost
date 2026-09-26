import { administers } from '@ghost/permissions';
import { createHash, randomUUID } from 'node:crypto';
import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { membershipIn } from '../../lib/organizations/administered-organization.js';
import {
  OrganizationForbiddenError,
  TeamNotFoundError,
  UserNotInOrganizationError,
} from '../../lib/organizations/organization.errors.js';
import { teamSlug } from '../../lib/organizations/team-slug.js';
import { UsersService } from '../../services/users/users.service.js';

/** Better Auth's own dedupe key for a team membership, so rows written here are found by its lookups too. */
function membershipKey(teamId: string, userId: string) {
  return createHash('sha256')
    .update(JSON.stringify([teamId, userId]))
    .digest('base64url');
}

/** Teams as members see them, and team membership as admins and team maintainers manage it. Membership is written here rather than through Better Auth, whose checks know only organization roles and would refuse a maintainer. */
@Injectable()
export class TeamsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UsersService,
  ) {}

  async list(slug: string, requesterId: string) {
    const { organizationId } = await membershipIn(this.db, slug, requesterId);
    const teams = await this.db
      .select({
        id: schema.team.id,
        name: schema.team.name,
        memberCount: schema.team.memberCount,
        repositoryCount: sql<number>`(select count(*)::int from ${schema.repositoryTeam} where ${schema.repositoryTeam.teamId} = ${schema.team.id})`,
      })
      .from(schema.team)
      .where(eq(schema.team.organizationId, organizationId))
      .orderBy(asc(schema.team.name));
    return {
      teams: teams.map((team) => ({ ...team, slug: teamSlug(team.name) })),
    };
  }

  /** One team, named by its slug: its members, which of them maintain it, and the repositories it reaches. */
  async get(slug: string, team: string, requesterId: string) {
    const { found, role } = await this.find(slug, team, requesterId);
    const [members, repositories, [maintainer]] = await Promise.all([
      this.db
        .select({
          username: sql<string>`${schema.user.username}`,
          name: schema.user.name,
          image: schema.user.image,
          maintainer: sql<boolean>`${schema.teamMaintainer.userId} is not null`,
        })
        .from(schema.teamMember)
        .innerJoin(schema.user, eq(schema.user.id, schema.teamMember.userId))
        .leftJoin(
          schema.teamMaintainer,
          and(
            eq(schema.teamMaintainer.teamId, schema.teamMember.teamId),
            eq(schema.teamMaintainer.userId, schema.teamMember.userId),
          ),
        )
        .where(eq(schema.teamMember.teamId, found.id))
        .orderBy(asc(schema.user.username)),
      this.db
        .select({
          slug: schema.repository.slug,
          name: schema.repository.name,
          visibility: schema.repository.visibility,
          role: schema.repositoryTeam.role,
        })
        .from(schema.repositoryTeam)
        .innerJoin(
          schema.repository,
          eq(schema.repository.id, schema.repositoryTeam.repositoryId),
        )
        .where(eq(schema.repositoryTeam.teamId, found.id))
        .orderBy(asc(schema.repository.slug)),
      this.maintainerRow(found.id, requesterId),
    ]);

    return {
      id: found.id,
      name: found.name,
      slug: teamSlug(found.name),
      members,
      repositories,
      viewerCanManage: administers(role) || Boolean(maintainer),
    };
  }

  async addMember(
    slug: string,
    team: string,
    username: string,
    requesterId: string,
  ) {
    const { found, organizationId } = await this.findManaged(
      slug,
      team,
      requesterId,
    );
    const user = await this.orgMember(organizationId, username);

    await this.db.transaction(async (tx) => {
      await tx
        .insert(schema.teamMember)
        .values({
          id: randomUUID(),
          teamId: found.id,
          userId: user.id,
          membershipKey: membershipKey(found.id, user.id),
          createdAt: new Date(),
        })
        .onConflictDoNothing();
      await this.recount(tx, found.id);
    });
  }

  async removeMember(
    slug: string,
    team: string,
    username: string,
    requesterId: string,
  ) {
    const { found } = await this.findManaged(slug, team, requesterId);
    const user = await this.users.getUserByUsername(username);

    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.teamMember)
        .where(
          and(
            eq(schema.teamMember.teamId, found.id),
            eq(schema.teamMember.userId, user.id),
          ),
        );
      // Someone off the team no longer maintains it.
      await tx
        .delete(schema.teamMaintainer)
        .where(
          and(
            eq(schema.teamMaintainer.teamId, found.id),
            eq(schema.teamMaintainer.userId, user.id),
          ),
        );
      await this.recount(tx, found.id);
    });
  }

  /** Maintainers are appointed by the organization's admins, from the team's own members. */
  async setMaintainer(
    slug: string,
    team: string,
    username: string,
    requesterId: string,
    maintain: boolean,
  ) {
    const { found, role } = await this.find(slug, team, requesterId);
    if (!administers(role)) throw new OrganizationForbiddenError();
    const user = await this.users.getUserByUsername(username);

    if (!maintain) {
      await this.db
        .delete(schema.teamMaintainer)
        .where(
          and(
            eq(schema.teamMaintainer.teamId, found.id),
            eq(schema.teamMaintainer.userId, user.id),
          ),
        );
      return;
    }

    const [onTeam] = await this.db
      .select({ id: schema.teamMember.id })
      .from(schema.teamMember)
      .where(
        and(
          eq(schema.teamMember.teamId, found.id),
          eq(schema.teamMember.userId, user.id),
        ),
      );
    if (!onTeam) throw new UserNotInOrganizationError(username);
    await this.db
      .insert(schema.teamMaintainer)
      .values({ teamId: found.id, userId: user.id })
      .onConflictDoNothing();
  }

  private async find(slug: string, team: string, requesterId: string) {
    const { organizationId, role } = await membershipIn(
      this.db,
      slug,
      requesterId,
    );
    const teams = await this.db
      .select({ id: schema.team.id, name: schema.team.name })
      .from(schema.team)
      .where(eq(schema.team.organizationId, organizationId));
    const found = teams.find((candidate) => teamSlug(candidate.name) === team);
    if (!found) throw new TeamNotFoundError();
    return { found, role, organizationId };
  }

  private async findManaged(slug: string, team: string, requesterId: string) {
    const found = await this.find(slug, team, requesterId);
    if (administers(found.role)) return found;
    const [maintainer] = await this.maintainerRow(found.found.id, requesterId);
    if (!maintainer) throw new OrganizationForbiddenError();
    return found;
  }

  private maintainerRow(teamId: string, userId: string) {
    return this.db
      .select({ userId: schema.teamMaintainer.userId })
      .from(schema.teamMaintainer)
      .where(
        and(
          eq(schema.teamMaintainer.teamId, teamId),
          eq(schema.teamMaintainer.userId, userId),
        ),
      );
  }

  /** A team only takes the organization's own members. */
  private async orgMember(organizationId: string, username: string) {
    const user = await this.users.getUserByUsername(username);
    const [membership] = await this.db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, organizationId),
          eq(schema.member.userId, user.id),
        ),
      );
    if (!membership) throw new UserNotInOrganizationError(username);
    return user;
  }

  private async recount(
    tx: Pick<Database, 'select' | 'update'>,
    teamId: string,
  ) {
    const [members] = await tx
      .select({ value: count() })
      .from(schema.teamMember)
      .where(eq(schema.teamMember.teamId, teamId));
    await tx
      .update(schema.team)
      .set({ memberCount: members?.value ?? 0 })
      .where(eq(schema.team.id, teamId));
  }
}
