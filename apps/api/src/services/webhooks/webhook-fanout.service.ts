import { randomUUID } from 'node:crypto';
import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, arrayContains, eq, inArray, or, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import type { StoredEvent } from '../../lib/events/events.js';
import { ownerNameOf } from '../../lib/git/repository-access/repository-access.js';

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
      .select({ id: schema.webhookEndpoint.id })
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
        body,
        idempotencyKey: `${event.id}:${endpoint.id}`,
      })),
    );
  }

  /** Sent when an endpoint is created and from its "Send test" button, whatever events it chose. */
  async ping(endpoint: {
    id: string;
    url: string;
    events: string[];
    repository: string;
  }) {
    await this.enqueue([
      {
        endpointId: endpoint.id,
        event: 'ping',
        body: JSON.stringify({
          event: 'ping',
          webhook: {
            id: endpoint.id,
            url: endpoint.url,
            events: endpoint.events,
          },
          repository: { full_name: endpoint.repository },
          created_at: new Date().toISOString(),
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

  /** The JSON a receiver gets. Null when what the event points at is gone. */
  private async bodyOf(event: StoredEvent): Promise<string | null> {
    const [repository] = await this.db
      .select({
        id: schema.repository.id,
        fullName: sql<string>`${ownerNameOf(schema.user, schema.organization)} || '/' || ${schema.repository.slug}`,
        visibility: schema.repository.visibility,
      })
      .from(schema.repository)
      .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
      .leftJoin(
        schema.organization,
        eq(schema.organization.id, schema.repository.organizationId),
      )
      .where(eq(schema.repository.id, event.repositoryId));
    if (!repository) return null;
    const repositoryUrl = `${this.appUrl}/${repository.fullName}`;

    const body: Record<string, unknown> = {
      event: event.type,
      repository: {
        id: repository.id,
        full_name: repository.fullName,
        visibility: repository.visibility,
        html_url: repositoryUrl,
      },
      sender: event.actorId ? await this.userRef(event.actorId) : null,
      created_at: new Date(event.createdAt).toISOString(),
    };

    if (event.type === 'push') {
      const { ref, before, after, commits } = event.payload;
      Object.assign(body, {
        ref,
        before,
        after,
        created: /^0+$/.test(before),
        deleted: /^0+$/.test(after),
        commits: commits.map((commit) => ({
          ...commit,
          html_url: `${repositoryUrl}/commit/${commit.sha}`,
        })),
      });
      return JSON.stringify(body);
    }

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
    body[thread.isPullRequest ? 'pull_request' : 'issue'] = {
      id: thread.id,
      number: thread.number,
      title: thread.title,
      body: thread.body,
      state: thread.state,
      author: await this.userRef(thread.authorId),
      html_url: `${repositoryUrl}/${kind}/${thread.number}`,
    };

    switch (event.type) {
      case 'issue.commented': {
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
      case 'pull_request.reviewed': {
        const [review] = await this.db
          .select({
            id: schema.pullRequestReview.id,
            state: schema.pullRequestReview.state,
            body: schema.pullRequestReview.body,
          })
          .from(schema.pullRequestReview)
          .where(eq(schema.pullRequestReview.id, event.payload.reviewId));
        if (!review) return null;
        body.review = review;
        break;
      }
      case 'issue.assigned': {
        const assignee = await this.userRef(event.payload.assigneeId);
        if (!assignee) return null;
        body.assignee = assignee;
        break;
      }
    }
    return JSON.stringify(body);
  }

  private async userRef(userId: string) {
    const [user] = await this.db
      .select({ id: schema.user.id, username: schema.user.username })
      .from(schema.user)
      .where(eq(schema.user.id, userId));
    return user ?? null;
  }
}
