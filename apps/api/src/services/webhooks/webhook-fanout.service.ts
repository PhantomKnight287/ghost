import { randomUUID } from 'node:crypto';
import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, arrayContains, eq, inArray, or, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import type { StoredEvent } from '../../lib/events/events.js';
import { renderWebhookBody } from '../../lib/webhooks/formats/index.js';
import type { WebhookBody, WebhookOwner } from '../../lib/webhooks/webhooks.js';
import { repositoryFullNameOf } from '../../lib/git/repository-access/repository-access.js';

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

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    config: ConfigService,
  ) {
    this.appUrl = config.get<string>('WEB_APP_URL') ?? 'http://localhost:3000';
  }

  async handle(event: StoredEvent) {
    const endpoints = await this.db
      .select({
        id: schema.webhookEndpoint.id,
        url: schema.webhookEndpoint.url,
      })
      .from(schema.webhookEndpoint)
      .where(
        and(
          eq(schema.webhookEndpoint.active, true),
          arrayContains(schema.webhookEndpoint.events, [event.type]),
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
    if (endpoints.length === 0) return;

    const body = await this.bodyOf(event);
    if (!body) return;
    await this.enqueue(
      endpoints.map((endpoint) => ({
        endpointId: endpoint.id,
        event: event.type,
        body: renderWebhookBody(endpoint.url, body),
        idempotencyKey: `${event.id}:${endpoint.id}`,
      })),
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
        body: renderWebhookBody(endpoint.url, {
          event: 'ping',
          webhook: endpoint,
          ...('repositoryId' in owner
            ? { repository: { fullName: owner.name } }
            : { organization: { slug: owner.name } }),
          createdAt: new Date().toISOString(),
        }),
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

  /** Null when what the event points at is gone. */
  private async bodyOf(event: StoredEvent): Promise<WebhookBody | null> {
    const repository = await this.repositoryRef(event.repositoryId);
    if (!repository) return null;

    const body: WebhookBody = {
      event: event.type,
      repository,
      sender: event.actorId ? await this.userRef(event.actorId) : null,
      createdAt: new Date(event.createdAt).toISOString(),
    };

    if ('issueId' in event.payload) {
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
        .where(eq(schema.issue.id, event.payload.issueId));
      if (!thread) return null;

      const kind = thread.isPullRequest ? 'pulls' : 'issues';
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
            path: schema.pullRequestReviewComment.path,
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
      .select({ id: schema.user.id, username: schema.user.username })
      .from(schema.user)
      .where(eq(schema.user.id, userId));
    return user ?? null;
  }
}
