import { randomUUID } from 'node:crypto';
import { type Database, schema } from '@ghost/db';
import { WEBHOOK_EVENTS, type WebhookEvent } from '@ghost/webhooks';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, arrayContains, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { grants } from '../../lib/apps/permissions.js';
import { isoTimestamp } from '../../lib/db/sql.js';
import type { StoredEvent } from '../../lib/events/events.js';
import {
  renderWebhookBody,
  type WebhookSender,
} from '../../lib/webhooks/formats/index.js';
import {
  type WebhookBody,
  webhookEventOf,
  type WebhookOwner,
} from '../../lib/webhooks/webhooks.js';
import { teamSlug } from '../../lib/organizations/team-slug.js';
import {
  installationCovers,
  repositoryFullNameOf,
} from '../../lib/repositories/access/repository-access.js';

type WebhookJob = {
  endpointId: string;
  event: string;
  /** The exact bytes the receiver gets and the signature covers, frozen here so a retry sends the same thing. */
  body: string;
  /** The same key enqueues once, so a retried outbox event queues no duplicate. */
  idempotencyKey: string;
};

/** Turns repository events into webhook jobs for apps/delivery, which signs and sends them. */
@Injectable()
export class WebhookFanoutService {
  private readonly appUrl: string;
  private readonly sender: WebhookSender;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    config: ConfigService,
  ) {
    this.appUrl = config.get<string>('WEB_APP_URL') ?? 'http://localhost:3000';
    this.sender = {
      name: 'Ghost',
      iconUrl: `${this.appUrl}/icons/icon-192.png`,
    };
  }

  async handle(event: StoredEvent) {
    const thread =
      'issueId' in event.payload
        ? await this.threadOf(event.payload.issueId)
        : null;
    if (thread === undefined) return;
    const name = webhookEventOf(event.type, thread?.isPullRequest ?? false);

    const endpoints = await this.db
      .select({
        id: schema.webhookEndpoint.id,
        url: schema.webhookEndpoint.url,
      })
      .from(schema.webhookEndpoint)
      .where(
        and(
          eq(schema.webhookEndpoint.active, true),
          arrayContains(schema.webhookEndpoint.events, [name]),
          or(
            eq(schema.webhookEndpoint.repositoryId, event.repositoryId),
            inArray(
              schema.webhookEndpoint.organizationId,
              this.db
                .select({ id: schema.repository.organizationId })
                .from(schema.repository)
                .where(eq(schema.repository.id, event.repositoryId)),
            ),
          ),
        ),
      );
    const apps = (await this.appEndpointsOf(event.repositoryId, name)).filter(
      (endpoint) =>
        name in WEBHOOK_EVENTS &&
        grants(
          endpoint.permissions,
          WEBHOOK_EVENTS[name as WebhookEvent].permission,
          'read',
        ),
    );
    if (endpoints.length === 0 && apps.length === 0) return;

    const body = await this.bodyOf(event, name, thread);
    if (!body) return;
    await this.enqueue([
      ...endpoints.map((endpoint) => ({
        endpointId: endpoint.id,
        event: name,
        body: renderWebhookBody(endpoint.url, body, this.sender),
        idempotencyKey: `${event.id}:${endpoint.id}`,
      })),
      ...apps.map((endpoint) => ({
        endpointId: endpoint.id,
        event: name,
        body: renderWebhookBody(
          endpoint.url,
          { ...body, installation: { id: endpoint.installationId } },
          this.sender,
        ),
        idempotencyKey: `${event.id}:${endpoint.id}`,
      })),
    ]);
  }

  /** The endpoints of apps whose live installation covers the repository and accepted the event, with the permissions it accepted. */
  private appEndpointsOf(repositoryId: string, name: string) {
    return this.db
      .select({
        id: schema.webhookEndpoint.id,
        url: schema.webhookEndpoint.url,
        installationId: schema.appInstallation.numericId,
        permissions: schema.appInstallation.permissions,
      })
      .from(schema.repository)
      .innerJoin(schema.appInstallation, installationCovers(schema.repository))
      .innerJoin(schema.app, eq(schema.app.id, schema.appInstallation.appId))
      .innerJoin(
        schema.webhookEndpoint,
        eq(schema.webhookEndpoint.appId, schema.app.id),
      )
      .where(
        and(
          eq(schema.repository.id, repositoryId),
          isNull(schema.app.deletedAt),
          isNull(schema.appInstallation.suspendedAt),
          eq(schema.webhookEndpoint.active, true),
          arrayContains(schema.appInstallation.events, [name]),
        ),
      );
  }

  /** Sent when an endpoint is created and from its "Send test" button, whatever events it chose. */
  async ping(
    endpoint: { id: string; url: string; events: string[] },
    owner: WebhookOwner,
  ) {
    await this.enqueue([
      {
        endpointId: endpoint.id,
        event: 'ping',
        body: renderWebhookBody(
          endpoint.url,
          {
            event: 'ping',
            webhook: endpoint,
            ...('repositoryId' in owner && {
              repository: { fullName: owner.name },
            }),
            ...('organizationId' in owner && {
              organization: { slug: owner.name },
            }),
            ...('appId' in owner && { app: { slug: owner.name } }),
            createdAt: new Date().toISOString(),
          },
          this.sender,
        ),
        idempotencyKey: `ping:${endpoint.id}:${randomUUID()}`,
      },
    ]);
  }

  async enqueue(jobs: WebhookJob[]) {
    if (jobs.length === 0) return;
    await this.db
      .insert(schema.deliveryJob)
      .values(
        jobs.map((job) => ({
          kind: 'webhook' as const,
          idempotencyKey: `webhook:${job.idempotencyKey}`,
          endpointId: job.endpointId,
          payload: { event: job.event, body: job.body },
        })),
      )
      .onConflictDoNothing();
    await this.db.execute(sql`NOTIFY delivery`);
  }

  /** The issue or pull request an event is about; undefined when it is gone. */
  private async threadOf(issueId: string) {
    const [thread] = await this.db
      .select({
        id: schema.issue.id,
        number: schema.issue.number,
        title: schema.issue.title,
        body: schema.issue.body,
        state: schema.issue.state,
        isPullRequest: schema.issue.isPullRequest,
        authorId: schema.issue.authorId,
      })
      .from(schema.issue)
      .where(eq(schema.issue.id, issueId));
    return thread;
  }

  /** Null when what the event points at is gone. */
  private async bodyOf(
    event: StoredEvent,
    name: WebhookBody['event'],
    thread: Awaited<ReturnType<typeof this.threadOf>> | null,
  ): Promise<WebhookBody | null> {
    const repository = await this.repositoryRef(event.repositoryId);
    if (!repository) return null;

    const body: WebhookBody = {
      event: name,
      repository,
      sender: event.actorId ? await this.userRef(event.actorId) : null,
      createdAt: new Date(event.createdAt).toISOString(),
    };

    if (thread) {
      const kind = thread.isPullRequest ? 'pull' : 'issues';
      body[thread.isPullRequest ? 'pullRequest' : 'issue'] = {
        id: thread.id,
        number: thread.number,
        title: thread.title,
        body: thread.body,
        state: thread.state,
        author: await this.userRef(thread.authorId),
        htmlUrl: `${repository.htmlUrl}/${kind}/${thread.number}`,
      };
    }

    switch (event.type) {
      case 'push': {
        const { ref, before, after, commits } = event.payload;
        Object.assign(body, {
          ref,
          before,
          after,
          created: /^0+$/.test(before),
          deleted: /^0+$/.test(after),
          commits,
        });
        break;
      }
      case 'pull_request.synchronized': {
        const { before, after, forced, commits } = event.payload;
        Object.assign(body, { before, after, forced, commits });
        break;
      }
      case 'issue.commented':
      case 'issue.comment_edited': {
        const [comment] = await this.db
          .select({
            id: schema.issueComment.id,
            body: schema.issueComment.body,
          })
          .from(schema.issueComment)
          .where(eq(schema.issueComment.id, event.payload.commentId));
        if (!comment) return null;
        body.comment = comment;
        break;
      }
      case 'issue.comment_deleted':
        body.comment = event.payload.comment;
        break;
      case 'pull_request.review_commented': {
        const [comment] = await this.db
          .select({
            id: schema.pullRequestReviewComment.id,
            body: schema.pullRequestReviewComment.body,
            numericId: schema.pullRequestReviewComment.numericId,
            path: schema.pullRequestReviewComment.path,
            side: schema.pullRequestReviewComment.side,
            line: schema.pullRequestReviewComment.line,
            startSide: schema.pullRequestReviewComment.startSide,
            startLine: schema.pullRequestReviewComment.startLine,
            inReplyToId: schema.pullRequestReviewComment.inReplyToId,
          })
          .from(schema.pullRequestReviewComment)
          .where(
            eq(schema.pullRequestReviewComment.id, event.payload.commentId),
          );
        if (!comment) return null;
        body.comment = comment;
        break;
      }
      case 'pull_request.reviewed':
      case 'pull_request.review_dismissed': {
        const [review] = await this.db
          .select({
            id: schema.pullRequestReview.id,
            numericId: schema.pullRequestReview.numericId,
            state: schema.pullRequestReview.state,
            body: schema.pullRequestReview.body,
            dismissalMessage: schema.pullRequestReview.dismissalMessage,
          })
          .from(schema.pullRequestReview)
          .where(eq(schema.pullRequestReview.id, event.payload.reviewId));
        if (!review) return null;
        body.review = review;
        break;
      }
      case 'issue.assigned':
      case 'issue.unassigned': {
        const assignee = await this.userRef(event.payload.assigneeId);
        if (!assignee) return null;
        body.assignee = assignee;
        break;
      }
      case 'pull_request.review_requested':
      case 'pull_request.review_request_removed': {
        const { requestedUserId, requestedTeamId } = event.payload;
        if (requestedUserId) {
          const reviewer = await this.userRef(requestedUserId);
          if (!reviewer) return null;
          body.requestedReviewer = reviewer;
        }
        if (requestedTeamId) {
          const [team] = await this.db
            .select({ id: schema.team.id, name: schema.team.name })
            .from(schema.team)
            .where(eq(schema.team.id, requestedTeamId));
          if (!team) return null;
          body.requestedTeam = { ...team, slug: teamSlug(team.name) };
        }
        break;
      }
      case 'member.added':
      case 'member.removed': {
        const member = await this.userRef(event.payload.userId);
        if (!member) return null;
        body.member = member;
        break;
      }
      case 'issue.labeled':
      case 'issue.unlabeled':
      case 'label.created':
      case 'label.edited': {
        const [label] = await this.db
          .select({
            id: schema.label.id,
            name: schema.label.name,
            description: schema.label.description,
            color: schema.label.color,
          })
          .from(schema.label)
          .where(eq(schema.label.id, event.payload.labelId));
        if (!label) return null;
        body.label = label;
        break;
      }
      case 'label.deleted':
        body.label = event.payload.label;
        break;
      case 'release.created':
      case 'release.published':
      case 'release.edited': {
        const [release] = await this.db
          .select({
            id: schema.release.id,
            tagName: schema.release.tagName,
            name: schema.release.name,
            body: schema.release.body,
            isDraft: schema.release.isDraft,
            isPrerelease: schema.release.isPrerelease,
            publishedAt: schema.release.publishedAt,
          })
          .from(schema.release)
          .where(eq(schema.release.id, event.payload.releaseId));
        if (!release) return null;
        body.release = {
          ...release,
          htmlUrl: `${repository.htmlUrl}/releases/tag/${release.tagName}`,
        };
        break;
      }
      case 'release.deleted':
        body.release = event.payload.release;
        break;
      case 'commit_status.created': {
        const [status] = await this.db
          .select({
            id: schema.commitStatus.id,
            sha: schema.commitStatus.sha,
            state: schema.commitStatus.state,
            context: schema.commitStatus.context,
            description: schema.commitStatus.description,
            targetUrl: schema.commitStatus.targetUrl,
            createdAt: isoTimestamp(schema.commitStatus.createdAt),
          })
          .from(schema.commitStatus)
          .where(eq(schema.commitStatus.id, event.payload.statusId));
        if (!status) return null;
        body.status = status;
        break;
      }
      case 'fork.created': {
        const fork = await this.repositoryRef(event.payload.forkId);
        if (!fork) return null;
        body.fork = fork;
        break;
      }
      case 'repository.transferred':
        body.from = event.payload.from;
        break;
    }
    return body;
  }

  private async repositoryRef(repositoryId: string) {
    const [repository] = await this.db
      .select({
        id: schema.repository.id,
        fullName: repositoryFullNameOf(
          schema.user,
          schema.organization,
          schema.repository,
        ),
        description: schema.repository.description,
        visibility: schema.repository.visibility,
        defaultBranch: schema.repository.defaultBranch,
      })
      .from(schema.repository)
      .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
      .leftJoin(
        schema.organization,
        eq(schema.organization.id, schema.repository.organizationId),
      )
      .where(eq(schema.repository.id, repositoryId));
    return repository
      ? { ...repository, htmlUrl: `${this.appUrl}/${repository.fullName}` }
      : null;
  }

  private async userRef(userId: string) {
    const [user] = await this.db
      .select({
        id: schema.user.id,
        username: schema.user.username,
        avatarUrl: schema.user.image,
      })
      .from(schema.user)
      .where(eq(schema.user.id, userId));
    return user
      ? {
          ...user,
          htmlUrl: user.username ? `${this.appUrl}/${user.username}` : null,
        }
      : null;
  }
}
