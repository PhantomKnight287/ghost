import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import type { OrganizationRole } from '@ghost/permissions';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { APIError } from 'better-auth/api';
import {
  and,
  asc,
  count,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { DATABASE } from '../../database/database.module.js';
import { administeredOrganization } from '../../lib/organizations/administered-organization.js';
import { AvatarStorageService } from '../../services/avatars/avatar-storage.service.js';
import type { UpdateOrganizationSettingsDTO } from './dto/organization.dto.js';
import {
  acceptedCollaboration,
  type CollaboratorRole,
  organizationMembership,
  readableBy,
} from '../../lib/git/repository-access/repository-access.js';
import { administers, organizationRoleOf } from '@ghost/permissions';
import { RepositoryNotFoundError } from '../repositories/repositories.errors.js';
import { UsersService } from '../../services/users/users.service.js';
import { isoTimestamp } from '../../utils/index.js';
import {
  InvitationRefusedError,
  OrganizationNotFoundError,
} from '../../lib/organizations/organization.errors.js';
import type { Auth } from '../../lib/auth.js';

const summaryColumns = {
  slug: schema.organization.slug,
  name: schema.organization.name,
  logo: schema.organization.logo,
};

@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UsersService,
    private readonly avatars: AvatarStorageService,
    private readonly auth: AuthService<Auth>,
  ) {}

  /** Pending, unexpired invitations addressed to the user's email. Better Auth lists these only for verified addresses, which leaves an instance without email verification unable to show them; the account's own address is proof enough here. */
  async listReceivedInvitations(userId: string) {
    const user = await this.users.getUserById(userId);
    const inviter = alias(schema.user, 'inviter');
    return {
      invitations: await this.db
        .select({
          id: schema.invitation.id,
          organization: summaryColumns,
          role: schema.invitation.role,
          invitedByUsername: inviter.username,
          expiresAt: isoTimestamp(schema.invitation.expiresAt),
        })
        .from(schema.invitation)
        .innerJoin(
          schema.organization,
          eq(schema.organization.id, schema.invitation.organizationId),
        )
        .leftJoin(inviter, eq(inviter.id, schema.invitation.inviterId))
        .where(
          and(
            eq(
              sql`lower(${schema.invitation.email})`,
              user.email.toLowerCase(),
            ),
            eq(schema.invitation.status, 'pending'),
            gt(schema.invitation.expiresAt, new Date()),
          ),
        )
        .orderBy(asc(schema.invitation.expiresAt)),
    };
  }

  /** Invites an account by its username. Better Auth invites by email, which only the server may know, so the address is looked up here and never leaves it. */
  async inviteByUsername({
    slug,
    username,
    role,
    requesterId,
    headers,
  }: {
    slug: string;
    username: string;
    role: OrganizationRole;
    requesterId: string;
    headers: Headers;
  }) {
    const { organizationId } = await administeredOrganization(
      this.db,
      slug,
      requesterId,
    );
    const user = await this.users.getUserByUsername(username);

    try {
      await this.auth.api.createInvitation({
        body: { email: user.email, role, organizationId },
        headers,
      });
    } catch (error) {
      if (error instanceof APIError) {
        throw new InvitationRefusedError(error.statusCode, error.message);
      }
      throw error;
    }
  }

  async getSettings(slug: string, requesterId: string) {
    const { settings } = await administeredOrganization(
      this.db,
      slug,
      requesterId,
    );
    if (!settings) throw new OrganizationNotFoundError(slug);
    const { organizationId: _, updatedAt: __, ...policies } = settings;
    return policies;
  }

  async updateSettings(
    slug: string,
    requesterId: string,
    changes: UpdateOrganizationSettingsDTO,
  ) {
    const { organizationId } = await administeredOrganization(
      this.db,
      slug,
      requesterId,
    );
    await this.db
      .insert(schema.organizationSettings)
      .values({ organizationId, ...changes })
      .onConflictDoUpdate({
        target: schema.organizationSettings.organizationId,
        set: changes,
      });
    return this.getSettings(slug, requesterId);
  }

  /** Stores a new logo and points the organization at it; the previous one is dropped. Admins only. */
  async setLogo({
    slug,
    requesterId,
    contentType,
    body,
  }: {
    slug: string;
    requesterId: string;
    contentType: string;
    body: Buffer | undefined;
  }) {
    const { organizationId } = await administeredOrganization(
      this.db,
      slug,
      requesterId,
    );
    const { url } = await this.avatars.store({
      ownerId: organizationId,
      contentType,
      body,
    });
    await this.db
      .update(schema.organization)
      .set({ logo: url })
      .where(eq(schema.organization.id, organizationId));
    return { url };
  }

  async removeLogo(slug: string, requesterId: string) {
    const { organizationId } = await administeredOrganization(
      this.db,
      slug,
      requesterId,
    );
    await this.db
      .update(schema.organization)
      .set({ logo: null })
      .where(eq(schema.organization.id, organizationId));
    await this.avatars.remove(organizationId);
  }

  /** The public face of an organization: its profile, pinned and public repositories, and the members who made their membership public. Members see every member, and pinned repositories they can read. */
  async getProfile(slug: string, requesterId?: string) {
    const [organization] = await this.db
      .select({
        id: schema.organization.id,
        ...summaryColumns,
        createdAt: isoTimestamp(schema.organization.createdAt),
        description: schema.organizationSettings.description,
        website: schema.organizationSettings.website,
        location: schema.organizationSettings.location,
        email: schema.organizationSettings.email,
      })
      .from(schema.organization)
      .leftJoin(
        schema.organizationSettings,
        eq(schema.organizationSettings.organizationId, schema.organization.id),
      )
      .where(eq(schema.organization.slug, slug));
    if (!organization) throw new OrganizationNotFoundError(slug);

    const [membership] = requesterId
      ? await this.db
          .select({ role: schema.member.role })
          .from(schema.member)
          .where(
            and(
              eq(schema.member.organizationId, organization.id),
              eq(schema.member.userId, requesterId),
            ),
          )
      : [];
    const viewer = requesterId ? { userId: requesterId } : null;

    const [[repositories], members, pinned] = await Promise.all([
      this.db
        .select({ value: count() })
        .from(schema.repository)
        .where(
          and(
            eq(schema.repository.organizationId, organization.id),
            eq(schema.repository.visibility, 'public'),
          ),
        ),
      this.db
        .select({
          username: sql<string>`${schema.user.username}`,
          name: schema.user.name,
          image: schema.user.image,
          public: sql<boolean>`${schema.organizationPublicMember.userId} is not null`,
        })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
        .leftJoin(
          schema.organizationPublicMember,
          and(
            eq(
              schema.organizationPublicMember.organizationId,
              schema.member.organizationId,
            ),
            eq(schema.organizationPublicMember.userId, schema.member.userId),
          ),
        )
        .where(
          and(
            eq(schema.member.organizationId, organization.id),
            isNotNull(schema.user.username),
            membership
              ? undefined
              : isNotNull(schema.organizationPublicMember.userId),
          ),
        )
        .orderBy(asc(schema.member.createdAt)),
      this.db
        .select({
          slug: schema.repository.slug,
          name: schema.repository.name,
          description: schema.repository.description,
          visibility: schema.repository.visibility,
        })
        .from(schema.organizationPinnedRepository)
        .innerJoin(
          schema.repository,
          eq(
            schema.repository.id,
            schema.organizationPinnedRepository.repositoryId,
          ),
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
            eq(
              schema.organizationPinnedRepository.organizationId,
              organization.id,
            ),
            readableBy(viewer),
          ),
        )
        .orderBy(asc(schema.organizationPinnedRepository.position)),
    ]);

    const { id: _, ...profile } = organization;
    return {
      ...profile,
      repositoryCount: repositories?.value ?? 0,
      members,
      pinned,
      viewerRole: membership ? organizationRoleOf(membership.role) : null,
    };
  }

  /** A user's organizations as `requesterId` may see them: all of them to the user, and to anyone else the ones the user made public and the ones they share. */
  async listForUser(username: string, requesterId?: string) {
    const user = await this.users.getUserByUsername(username);
    const viewer = alias(schema.member, 'viewer');
    return {
      organizations: await this.db
        .select(summaryColumns)
        .from(schema.member)
        .innerJoin(
          schema.organization,
          eq(schema.organization.id, schema.member.organizationId),
        )
        .leftJoin(
          schema.organizationPublicMember,
          and(
            eq(
              schema.organizationPublicMember.organizationId,
              schema.member.organizationId,
            ),
            eq(schema.organizationPublicMember.userId, user.id),
          ),
        )
        .leftJoin(
          viewer,
          and(
            eq(viewer.organizationId, schema.member.organizationId),
            requesterId ? eq(viewer.userId, requesterId) : sql`false`,
          ),
        )
        .where(
          and(
            eq(schema.member.userId, user.id),
            requesterId === user.id
              ? undefined
              : or(
                  isNotNull(schema.organizationPublicMember.userId),
                  isNotNull(viewer.id),
                ),
          ),
        )
        .orderBy(asc(schema.organization.slug)),
    };
  }

  /** Shows or hides the requester's own membership to people outside the organization. */
  async setMembershipPublic(slug: string, requesterId: string, show: boolean) {
    const [membership] = await this.db
      .select({ organizationId: schema.member.organizationId })
      .from(schema.member)
      .innerJoin(
        schema.organization,
        eq(schema.organization.id, schema.member.organizationId),
      )
      .where(
        and(
          eq(schema.organization.slug, slug),
          eq(schema.member.userId, requesterId),
        ),
      );
    if (!membership) throw new OrganizationNotFoundError(slug);

    const row = {
      organizationId: membership.organizationId,
      userId: requesterId,
    };
    if (show) {
      await this.db
        .insert(schema.organizationPublicMember)
        .values(row)
        .onConflictDoNothing();
    } else {
      await this.db
        .delete(schema.organizationPublicMember)
        .where(
          and(
            eq(
              schema.organizationPublicMember.organizationId,
              row.organizationId,
            ),
            eq(schema.organizationPublicMember.userId, requesterId),
          ),
        );
    }
  }

  /** Replaces the pinned repositories, in the order given. Only the organization's own repositories can be pinned. */
  async setPinned(slug: string, requesterId: string, slugs: string[]) {
    const { organizationId } = await administeredOrganization(
      this.db,
      slug,
      requesterId,
    );
    const repositories = slugs.length
      ? await this.db
          .select({
            id: schema.repository.id,
            slug: schema.repository.slug,
          })
          .from(schema.repository)
          .where(
            and(
              eq(schema.repository.organizationId, organizationId),
              inArray(schema.repository.slug, slugs),
            ),
          )
      : [];
    const idOf = new Map(repositories.map((row) => [row.slug, row.id]));
    const missing = slugs.find((wanted) => !idOf.has(wanted));
    if (missing) throw new RepositoryNotFoundError();

    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.organizationPinnedRepository)
        .where(
          eq(
            schema.organizationPinnedRepository.organizationId,
            organizationId,
          ),
        );
      if (slugs.length === 0) return;
      await tx.insert(schema.organizationPinnedRepository).values(
        slugs.map((wanted, position) => ({
          organizationId,
          repositoryId: idOf.get(wanted)!,
          position,
        })),
      );
    });
  }

  /** People with access to the organization's repositories who are not its members, each with the repositories they hold and at what role. Pending invitations count, since they are access on its way. */
  async listOutsideCollaborators(slug: string, requesterId: string) {
    const { organizationId } = await administeredOrganization(
      this.db,
      slug,
      requesterId,
    );
    const rows = await this.db
      .select({
        userId: schema.user.id,
        username: sql<string>`${schema.user.username}`,
        name: schema.user.name,
        image: schema.user.image,
        repository: schema.repository.slug,
        role: schema.repositoryCollaborator.role,
        pending: sql<boolean>`${schema.repositoryCollaborator.acceptedAt} is null`,
      })
      .from(schema.repositoryCollaborator)
      .innerJoin(
        schema.repository,
        eq(schema.repository.id, schema.repositoryCollaborator.repositoryId),
      )
      .innerJoin(
        schema.user,
        eq(schema.user.id, schema.repositoryCollaborator.userId),
      )
      .leftJoin(
        schema.member,
        and(
          eq(schema.member.organizationId, organizationId),
          eq(schema.member.userId, schema.repositoryCollaborator.userId),
        ),
      )
      .where(
        and(
          eq(schema.repository.organizationId, organizationId),
          isNull(schema.member.id),
        ),
      )
      .orderBy(asc(schema.user.username), asc(schema.repository.slug));

    // One entry per person: rows come one per repository.
    const people = new Map<
      string,
      {
        username: string;
        name: string;
        image: string | null;
        repositories: {
          slug: string;
          role: CollaboratorRole;
          pending: boolean;
        }[];
      }
    >();
    for (const { userId, repository, role, pending, ...person } of rows) {
      const entry = people.get(userId) ?? { ...person, repositories: [] };
      entry.repositories.push({ slug: repository, role, pending });
      people.set(userId, entry);
    }
    return { collaborators: [...people.values()] };
  }

  /** Takes an outside collaborator off every repository of the organization at once. */
  async removeOutsideCollaborator(
    slug: string,
    requesterId: string,
    username: string,
  ) {
    const { organizationId } = await administeredOrganization(
      this.db,
      slug,
      requesterId,
    );
    const user = await this.users.getUserByUsername(username);
    await this.db
      .delete(schema.repositoryCollaborator)
      .where(
        and(
          eq(schema.repositoryCollaborator.userId, user.id),
          inArray(
            schema.repositoryCollaborator.repositoryId,
            this.db
              .select({ id: schema.repository.id })
              .from(schema.repository)
              .where(eq(schema.repository.organizationId, organizationId)),
          ),
        ),
      );
  }

  /** The requester's organizations, their role in each, and whether its policy lets them create repositories there. */
  async listMine(userId: string) {
    const rows = await this.db
      .select({
        ...summaryColumns,
        role: schema.member.role,
        membersCanCreate: sql<boolean>`coalesce(${schema.organizationSettings.membersCanCreatePublicRepositories} or ${schema.organizationSettings.membersCanCreatePrivateRepositories}, false)`,
      })
      .from(schema.member)
      .innerJoin(
        schema.organization,
        eq(schema.organization.id, schema.member.organizationId),
      )
      .leftJoin(
        schema.organizationSettings,
        eq(schema.organizationSettings.organizationId, schema.organization.id),
      )
      .where(eq(schema.member.userId, userId))
      .orderBy(asc(schema.organization.slug));

    return {
      organizations: rows.map(({ role, membersCanCreate, ...organization }) => {
        const viewerRole = organizationRoleOf(role);
        return {
          ...organization,
          viewerRole,
          canCreateRepositories: administers(viewerRole) || membersCanCreate,
        };
      }),
    };
  }
}
