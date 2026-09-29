import { randomUUID } from 'node:crypto';
import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, inArray } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import {
  newWebhookSecret,
  sealWebhookSecret,
  type WebhookEvent,
  webhookSecretKey,
  webhookUrlProblem,
} from '../../lib/webhooks/webhooks.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { WebhookFanoutService } from '../../services/webhooks/webhook-fanout.service.js';
import { isoTimestamp } from '../../utils/index.js';
import {
  DeliveryNotFoundError,
  InvalidWebhookUrlError,
  WebhookNotFoundError,
  WebhooksNotConfiguredError,
} from './webhooks.errors.js';

const DELIVERY_LOG_LENGTH = 50;

interface RepositoryRef {
  username: string;
  repo: string;
  requesterId: string;
}

const webhookColumns = {
  id: schema.webhookEndpoint.id,
  url: schema.webhookEndpoint.url,
  events: schema.webhookEndpoint.events,
  active: schema.webhookEndpoint.active,
  disabledReason: schema.webhookEndpoint.disabledReason,
  createdAt: isoTimestamp(schema.webhookEndpoint.createdAt),
};

/** A repository's webhook endpoints and their delivery log. Admins only. */
@Injectable()
export class WebhooksService {
  private readonly key: Buffer | undefined;
  private readonly allowPrivate: boolean;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: RepositoryAccessService,
    private readonly fanout: WebhookFanoutService,
    config: ConfigService,
  ) {
    this.key = webhookSecretKey(config.get<string>('WEBHOOK_SECRET_KEY'));
    this.allowPrivate =
      config.get<string>('WEBHOOK_ALLOW_PRIVATE_NETWORKS') === 'true';
  }

  async list(ref: RepositoryRef) {
    const repository = await this.authorizeAdmin(ref);
    const webhooks = await this.db
      .select(webhookColumns)
      .from(schema.webhookEndpoint)
      .where(eq(schema.webhookEndpoint.repositoryId, repository.id))
      .orderBy(schema.webhookEndpoint.createdAt);
    return { webhooks: webhooks.map(typed) };
  }

  /** Creates the endpoint, sends it a `ping`, and returns its secret, the only time anyone sees it. */
  async create(ref: RepositoryRef & { url: string; events: WebhookEvent[] }) {
    const repository = await this.authorizeAdmin(ref);
    if (!this.key) throw new WebhooksNotConfiguredError();
    await this.checkUrl(ref.url);

    const secret = newWebhookSecret();
    const [webhook] = await this.db
      .insert(schema.webhookEndpoint)
      .values({
        repositoryId: repository.id,
        url: ref.url,
        secret: sealWebhookSecret(this.key, secret),
        events: [...new Set(ref.events)],
      })
      .returning(webhookColumns);
    await this.fanout.ping({
      ...webhook,
      repository: `${ref.username}/${ref.repo}`,
    });
    return { ...typed(webhook), secret };
  }

  async update(
    ref: RepositoryRef & {
      webhookId: string;
      url?: string;
      events?: WebhookEvent[];
      active?: boolean;
    },
  ) {
    const repository = await this.authorizeAdmin(ref);
    await this.find(repository.id, ref.webhookId);
    if (ref.url !== undefined) await this.checkUrl(ref.url);

    const [webhook] = await this.db
      .update(schema.webhookEndpoint)
      .set({
        url: ref.url,
        events: ref.events && [...new Set(ref.events)],
        active: ref.active,
        // turning it back on is the owner saying the problem is fixed
        ...(ref.active === true && { disabledReason: null }),
      })
      .where(eq(schema.webhookEndpoint.id, ref.webhookId))
      .returning(webhookColumns);
    return typed(webhook);
  }

  /** Pending deliveries go with it. */
  async remove(ref: RepositoryRef & { webhookId: string }) {
    const repository = await this.authorizeAdmin(ref);
    await this.find(repository.id, ref.webhookId);
    await this.db
      .delete(schema.webhookEndpoint)
      .where(eq(schema.webhookEndpoint.id, ref.webhookId));
  }

  async ping(ref: RepositoryRef & { webhookId: string }) {
    const repository = await this.authorizeAdmin(ref);
    const webhook = await this.find(repository.id, ref.webhookId);
    await this.fanout.ping({
      ...webhook,
      repository: `${ref.username}/${ref.repo}`,
    });
  }

  async deliveries(ref: RepositoryRef & { webhookId: string }) {
    const repository = await this.authorizeAdmin(ref);
    await this.find(repository.id, ref.webhookId);

    const jobs = await this.db
      .select({
        id: schema.deliveryJob.id,
        status: schema.deliveryJob.status,
        payload: schema.deliveryJob.payload,
        createdAt: isoTimestamp(schema.deliveryJob.createdAt),
        nextAttemptAt: isoTimestamp(schema.deliveryJob.nextAttemptAt),
      })
      .from(schema.deliveryJob)
      .where(eq(schema.deliveryJob.endpointId, ref.webhookId))
      .orderBy(desc(schema.deliveryJob.createdAt))
      .limit(DELIVERY_LOG_LENGTH);
    const attempts = jobs.length
      ? await this.db
          .select({
            jobId: schema.deliveryAttempt.jobId,
            startedAt: isoTimestamp(schema.deliveryAttempt.startedAt),
            durationMs: schema.deliveryAttempt.durationMs,
            statusCode: schema.deliveryAttempt.statusCode,
            error: schema.deliveryAttempt.error,
            requestHeaders: schema.deliveryAttempt.requestHeaders,
            responseBody: schema.deliveryAttempt.responseBody,
          })
          .from(schema.deliveryAttempt)
          .where(
            inArray(
              schema.deliveryAttempt.jobId,
              jobs.map((job) => job.id),
            ),
          )
          .orderBy(desc(schema.deliveryAttempt.startedAt))
      : [];

    return {
      deliveries: jobs.map((job) => {
        const payload = job.payload as { event: string; body: string };
        return {
          id: job.id,
          event: payload.event,
          status: job.status,
          body: payload.body,
          createdAt: job.createdAt,
          nextAttemptAt: job.status === 'pending' ? job.nextAttemptAt : null,
          attempts: attempts
            .filter((attempt) => attempt.jobId === job.id)
            .map((attempt) => ({
              startedAt: attempt.startedAt,
              durationMs: attempt.durationMs,
              statusCode: attempt.statusCode,
              error: attempt.error,
              requestHeaders: attempt.requestHeaders as Record<string, string>,
              responseBody: attempt.responseBody,
            })),
        };
      }),
    };
  }

  /** Sends the same body again as a new delivery with its own id and a fresh round of retries. */
  async redeliver(
    ref: RepositoryRef & { webhookId: string; deliveryId: string },
  ) {
    const repository = await this.authorizeAdmin(ref);
    await this.find(repository.id, ref.webhookId);
    const [job] = await this.db
      .select({ payload: schema.deliveryJob.payload })
      .from(schema.deliveryJob)
      .where(
        and(
          eq(schema.deliveryJob.id, ref.deliveryId),
          eq(schema.deliveryJob.endpointId, ref.webhookId),
        ),
      );
    if (!job) throw new DeliveryNotFoundError();
    const payload = job.payload as { event: string; body: string };
    await this.fanout.enqueue([
      {
        endpointId: ref.webhookId,
        event: payload.event,
        body: payload.body,
        idempotencyKey: `redeliver:${ref.deliveryId}:${randomUUID()}`,
      },
    ]);
  }

  private async find(repositoryId: string, webhookId: string) {
    const [webhook] = await this.db
      .select(webhookColumns)
      .from(schema.webhookEndpoint)
      .where(
        and(
          eq(schema.webhookEndpoint.id, webhookId),
          eq(schema.webhookEndpoint.repositoryId, repositoryId),
        ),
      );
    if (!webhook) throw new WebhookNotFoundError();
    return webhook;
  }

  private async checkUrl(url: string) {
    const problem = await webhookUrlProblem(url, this.allowPrivate);
    if (problem) throw new InvalidWebhookUrlError(problem);
  }

  private authorizeAdmin({ username, repo, requesterId }: RepositoryRef) {
    return this.access.authorize({
      username,
      repo,
      actor: { userId: requesterId },
      operation: 'admin',
    });
  }
}

/** `events` is text[] in the database; only the API writes it, from the validated list. */
function typed<T extends { events: string[] }>(webhook: T) {
  return { ...webhook, events: webhook.events as WebhookEvent[] };
}
