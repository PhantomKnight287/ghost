import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, lt, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { DATABASE } from '../../database/database.module.js';
import {
  acceptedCollaboration,
  organizationMembership,
  ownerNameOf,
  readableBy,
} from '../../lib/git/repository-access/repository-access.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { decodeCursor, encodeCursor, isoTimestamp } from '../../utils/index.js';
import { IssuesService } from '../issues/issues.service.js';
import { InvalidCursorError } from '../repositories/repositories.errors.js';
import type {
  GetNotificationsQueryDTO,
  GetNotificationsResponseDTO,
  WatchLevel,
} from './dto/notification.dto.js';
import { NotificationNotFoundError } from './notifications.errors.js';

const DEFAULT_PAGE_SIZE = 25;

const actor = alias(schema.user, 'actor');

type IssueRef = {
  username: string;
  repo: string;
  number: number;
  requesterId: string;
};
type RepositoryRef = { username: string; repo: string; requesterId: string };

/** The inbox, and what decides what lands in it: thread subscriptions and repository watching. */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: RepositoryAccessService,
    private readonly issues: IssuesService,
  ) {}

  async list(
    userId: string,
    query: GetNotificationsQueryDTO,
  ): Promise<GetNotificationsResponseDTO> {
    const decoded = query.cursor ? decodeCursor(query.cursor) : null;
    if (query.cursor && !decoded) throw new InvalidCursorError();
    const pageSize = query.limit ?? DEFAULT_PAGE_SIZE;

    const rows = await this.inbox(
      userId,
      and(
        query.unread ? eq(schema.notification.unread, true) : undefined,
        decoded
          ? or(
              lt(schema.notification.updatedAt, decoded.date),
              and(
                eq(schema.notification.updatedAt, decoded.date),
                lt(schema.notification.id, decoded.id),
              ),
            )
          : undefined,
      ),
    )
      .orderBy(
        desc(schema.notification.updatedAt),
        desc(schema.notification.id),
      )
      .limit(pageSize + 1);

    const page = rows.slice(0, pageSize);
    const last = page.at(-1);
    return {
      notifications: page,
      nextCursor:
        rows.length > pageSize && last
          ? encodeCursor({ date: new Date(last.updatedAt), id: last.id })
          : null,
    };
  }

  async unreadCount(userId: string) {
    const [row] = await this.db
      .select({ count: count() })
      .from(
        this.inbox(userId, eq(schema.notification.unread, true)).as('inbox'),
      );
    return { count: row.count };
  }

  async setUnread(userId: string, id: string, unread: boolean) {
    const updated = await this.db
      .update(schema.notification)
      .set({ unread })
      .where(
        and(
          eq(schema.notification.id, id),
          eq(schema.notification.userId, userId),
        ),
      )
      .returning({ id: schema.notification.id });
    if (updated.length === 0) throw new NotificationNotFoundError();
  }

  async markAllRead(userId: string) {
    await this.db
      .update(schema.notification)
      .set({ unread: false })
      .where(
        and(
          eq(schema.notification.userId, userId),
          eq(schema.notification.unread, true),
        ),
      );
  }

  async getSubscription(target: IssueRef) {
    const { issue } = await this.issues.load(target);
    const [row] = await this.db
      .select({ subscribed: schema.issueSubscription.subscribed })
      .from(schema.issueSubscription)
      .where(
        and(
          eq(schema.issueSubscription.issueId, issue.id),
          eq(schema.issueSubscription.userId, target.requesterId),
        ),
      );
    return { subscribed: row?.subscribed ?? false };
  }

  async setSubscription(target: IssueRef & { subscribed: boolean }) {
    const { issue } = await this.issues.load(target);
    await this.db
      .insert(schema.issueSubscription)
      .values({
        userId: target.requesterId,
        issueId: issue.id,
        subscribed: target.subscribed,
      })
      .onConflictDoUpdate({
        target: [
          schema.issueSubscription.userId,
          schema.issueSubscription.issueId,
        ],
        set: { subscribed: target.subscribed },
      });
    return { subscribed: target.subscribed };
  }

  async getWatch(target: RepositoryRef): Promise<{ level: WatchLevel }> {
    const repository = await this.authorize(target);
    const [row] = await this.db
      .select({ level: schema.repositoryWatch.level })
      .from(schema.repositoryWatch)
      .where(watchOf(repository.id, target.requesterId));
    return { level: row?.level ?? 'participating' };
  }

  async setWatch(target: RepositoryRef & { level: WatchLevel }) {
    const repository = await this.authorize(target);
    if (target.level === 'participating') {
      await this.db
        .delete(schema.repositoryWatch)
        .where(watchOf(repository.id, target.requesterId));
    } else {
      await this.db
        .insert(schema.repositoryWatch)
        .values({
          userId: target.requesterId,
          repositoryId: repository.id,
          level: target.level,
        })
        .onConflictDoUpdate({
          target: [
            schema.repositoryWatch.userId,
            schema.repositoryWatch.repositoryId,
          ],
          set: { level: target.level },
        });
    }
    return { level: target.level };
  }

  /** The user's notifications on threads they can still read: losing access to a repository hides what it sent them. */
  private inbox(userId: string, where: SQL | undefined) {
    const viewer = { userId };
    return this.db
      .select({
        id: schema.notification.id,
        reason: schema.notification.reason,
        eventType: schema.notification.eventType,
        actorUsername: actor.username,
        unread: schema.notification.unread,
        updatedAt: isoTimestamp(schema.notification.updatedAt),
        repository: {
          owner: ownerNameOf(schema.user, schema.organization),
          slug: schema.repository.slug,
        },
        thread: {
          number: schema.issue.number,
          title: schema.issue.title,
          isPullRequest: schema.issue.isPullRequest,
          state: sql<
            'open' | 'closed' | 'merged'
          >`case when ${schema.pullRequest.state} = 'merged' then 'merged' else ${schema.issue.state}::text end`,
        },
      })
      .from(schema.notification)
      .innerJoin(schema.issue, eq(schema.issue.id, schema.notification.issueId))
      .innerJoin(
        schema.repository,
        eq(schema.repository.id, schema.issue.repositoryId),
      )
      .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
      .leftJoin(
        schema.organization,
        eq(schema.organization.id, schema.repository.organizationId),
      )
      .leftJoin(
        schema.repositoryCollaborator,
        acceptedCollaboration(schema.repository.id, viewer),
      )
      .leftJoin(
        schema.member,
        organizationMembership(schema.repository.organizationId, viewer),
      )
      .leftJoin(actor, eq(actor.id, schema.notification.actorId))
      .leftJoin(
        schema.pullRequest,
        eq(schema.pullRequest.issueId, schema.issue.id),
      )
      .where(
        and(eq(schema.notification.userId, userId), readableBy(viewer), where),
      );
  }

  private authorize({ username, repo, requesterId }: RepositoryRef) {
    return this.access.authorize({
      username,
      repo,
      actor: { userId: requesterId },
      operation: 'read',
    });
  }
}

function watchOf(repositoryId: string, userId: string) {
  return and(
    eq(schema.repositoryWatch.repositoryId, repositoryId),
    eq(schema.repositoryWatch.userId, userId),
  );
}
