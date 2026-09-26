import { type Database, schema } from '@ghost/db';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { DATABASE } from '../../database/database.module.js';
import { mailConfigured } from '../../mail/mail.module.js';
import { MailService } from '../../mail/mail.service.js';
import {
  type CollaboratorRole,
  RepositoryAccessService,
} from '../../services/git/repository-access/repository-access.service.js';
import { UsersService } from '../../services/users/users.service.js';
import { isoTimestamp } from '../../utils/index.js';
import type { CollaboratorStatus } from './dto/collaborator.dto.js';
import {
  CannotInviteOwnerError,
  CollaboratorNotFoundError,
  InvitationNotFoundError,
} from './collaborators.errors.js';

const owner = alias(schema.user, 'owner');
const inviter = alias(schema.user, 'inviter');

// An invitation lapses a week after it was sent. The row stays, so an admin sees it lapsed and can send it again.
const expiresAt = sql`(${schema.repositoryCollaborator.createdAt} + interval '7 days')`;

interface RepositoryRef {
  username: string;
  repo: string;
  requesterId: string;
}

@Injectable()
export class CollaboratorsService {
  private readonly logger = new Logger(CollaboratorsService.name);
  private readonly mailEnabled: boolean;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: RepositoryAccessService,
    private readonly users: UsersService,
    private readonly mail: MailService,
    config: ConfigService,
  ) {
    this.mailEnabled = mailConfigured(config);
  }

  /** Accepted collaborators and pending invitations, oldest first. */
  async list(ref: RepositoryRef) {
    const repository = await this.authorizeAdmin(ref);
    return { collaborators: await this.rows(repository.id) };
  }

  /** Invites `collaborator`, or changes the role of someone already invited or collaborating. Only a new invitation sends an email. */
  async invite(
    ref: RepositoryRef & { collaborator: string; role: CollaboratorRole },
  ) {
    const repository = await this.authorizeAdmin(ref);
    const user = await this.users.getUserByUsername(ref.collaborator);
    if (user.id === repository.ownerId) throw new CannotInviteOwnerError();

    // A lapsed invitation is sent again as if new, restarting its week.
    const [renewed] = await this.db
      .update(schema.repositoryCollaborator)
      .set({
        role: ref.role,
        invitedById: ref.requesterId,
        createdAt: new Date(),
      })
      .where(
        and(
          this.membership(repository.id, user.id),
          isNull(schema.repositoryCollaborator.acceptedAt),
          sql`${expiresAt} <= now()`,
        ),
      )
      .returning({ id: schema.repositoryCollaborator.id });

    const [invited] = renewed
      ? [renewed]
      : await this.db
          .insert(schema.repositoryCollaborator)
          .values({
            repositoryId: repository.id,
            userId: user.id,
            role: ref.role,
            invitedById: ref.requesterId,
          })
          .onConflictDoNothing()
          .returning({ id: schema.repositoryCollaborator.id });

    if (invited) {
      await this.notify(user, ref);
    } else {
      await this.db
        .update(schema.repositoryCollaborator)
        .set({ role: ref.role })
        .where(this.membership(repository.id, user.id));
    }

    const [collaborator] = await this.rows(repository.id, user.id);
    return collaborator;
  }

  /** Removes a collaborator or withdraws an invitation. A collaborator may also remove themselves, which is leaving. */
  async remove(ref: RepositoryRef & { collaborator: string }) {
    const user = await this.users.getUserByUsername(ref.collaborator);
    const repository = await this.access.authorize({
      username: ref.username,
      repo: ref.repo,
      actor: { userId: ref.requesterId },
      operation: user.id === ref.requesterId ? 'read' : 'admin',
    });

    const removed = await this.db
      .delete(schema.repositoryCollaborator)
      .where(this.membership(repository.id, user.id))
      .returning({ id: schema.repositoryCollaborator.id });
    if (removed.length === 0)
      throw new CollaboratorNotFoundError(ref.collaborator);
  }

  async listInvitations(userId: string) {
    const invitations = await this.db
      .select({
        id: schema.repositoryCollaborator.id,
        repository: {
          username: sql<string>`coalesce(${owner.username}, '')`,
          slug: schema.repository.slug,
          name: schema.repository.name,
        },
        role: schema.repositoryCollaborator.role,
        invitedByUsername: inviter.username,
        invitedAt: isoTimestamp(schema.repositoryCollaborator.createdAt),
        expiresAt: isoTimestamp(expiresAt),
      })
      .from(schema.repositoryCollaborator)
      .innerJoin(
        schema.repository,
        eq(schema.repository.id, schema.repositoryCollaborator.repositoryId),
      )
      .innerJoin(owner, eq(owner.id, schema.repository.ownerId))
      .leftJoin(
        inviter,
        eq(inviter.id, schema.repositoryCollaborator.invitedById),
      )
      .where(this.pendingFor(userId))
      .orderBy(asc(schema.repositoryCollaborator.createdAt));

    return { invitations };
  }

  async acceptInvitation(id: string, userId: string) {
    const accepted = await this.db
      .update(schema.repositoryCollaborator)
      .set({ acceptedAt: new Date() })
      .where(
        and(eq(schema.repositoryCollaborator.id, id), this.pendingFor(userId)),
      )
      .returning({ id: schema.repositoryCollaborator.id });
    if (accepted.length === 0) throw new InvitationNotFoundError();
  }

  async declineInvitation(id: string, userId: string) {
    const declined = await this.db
      .delete(schema.repositoryCollaborator)
      .where(
        and(eq(schema.repositoryCollaborator.id, id), this.pendingFor(userId)),
      )
      .returning({ id: schema.repositoryCollaborator.id });
    if (declined.length === 0) throw new InvitationNotFoundError();
  }

  private rows(repositoryId: string, userId?: string) {
    return this.db
      .select({
        username: sql<string>`coalesce(${schema.user.username}, '')`,
        name: schema.user.name,
        image: schema.user.image,
        role: schema.repositoryCollaborator.role,
        status: sql<CollaboratorStatus>`case when ${schema.repositoryCollaborator.acceptedAt} is not null then 'accepted' when ${expiresAt} > now() then 'pending' else 'expired' end`,
        invitedAt: isoTimestamp(schema.repositoryCollaborator.createdAt),
        expiresAt: sql<
          string | null
        >`case when ${schema.repositoryCollaborator.acceptedAt} is null then ${isoTimestamp(expiresAt)} end`,
      })
      .from(schema.repositoryCollaborator)
      .innerJoin(
        schema.user,
        eq(schema.user.id, schema.repositoryCollaborator.userId),
      )
      .where(
        userId
          ? this.membership(repositoryId, userId)
          : eq(schema.repositoryCollaborator.repositoryId, repositoryId),
      )
      .orderBy(asc(schema.repositoryCollaborator.createdAt));
  }

  private membership(repositoryId: string, userId: string) {
    return and(
      eq(schema.repositoryCollaborator.repositoryId, repositoryId),
      eq(schema.repositoryCollaborator.userId, userId),
    );
  }

  /** Invitations `userId` can still act on: neither accepted nor lapsed. */
  private pendingFor(userId: string) {
    return and(
      eq(schema.repositoryCollaborator.userId, userId),
      isNull(schema.repositoryCollaborator.acceptedAt),
      sql`${expiresAt} > now()`,
    );
  }

  private authorizeAdmin({ username, repo, requesterId }: RepositoryRef) {
    return this.access.authorize({
      username,
      repo,
      actor: { userId: requesterId },
      operation: 'admin',
    });
  }

  /** The invitation stands whether or not the email goes out: the invitee also finds it on their dashboard. */
  private async notify(
    user: { name: string; email: string },
    ref: RepositoryRef & { role: CollaboratorRole },
  ) {
    if (!this.mailEnabled) return;

    const sender = await this.users.getUserById(ref.requesterId);
    await this.mail
      .sendRepositoryInvitationEmail(user.email, {
        name: user.name,
        inviter: sender.username ?? sender.name,
        repository: `${ref.username}/${ref.repo}`,
        role: ref.role,
      })
      .catch((error: unknown) =>
        this.logger.warn(
          `Invitation email to ${user.email} failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  }
}
