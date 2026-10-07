import { randomUUID } from 'node:crypto';
import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { administeredOrganization } from '../../lib/organizations/administered-organization.js';
import {
  newWebhookSecret,
  sealWebhookSecret,
  type WebhookEvent,
  type WebhookOwner,
  webhookSecretKey,
  webhookUrlProblem,
} from '../../lib/webhooks/webhooks.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { WebhookFanoutService } from '../../services/webhooks/webhook-fanout.service.js';
import { isoTimestamp } from '../../lib/db/sql.js';
import type { DeliveryAttemptDTO } from './dto/webhook.dto.js';
import {
  DeliveryNotFoundError,
  InvalidWebhookUrlError,
  WebhookNotFoundError,
  WebhooksNotConfiguredError,
} from './webhooks.errors.js';

const DELIVERY_LOG_LENGTH = 50;

const webhookColumns = {
  id: schema.webhookEndpoint.id,
  url: schema.webhookEndpoint.url,
  // only this service writes it, from the validated list
  events: sql<WebhookEvent[]>`${schema.webhookEndpoint.events}`,
  active: schema.webhookEndpoint.active,
  disabledReason: schema.webhookEndpoint.disabledReason,
  createdAt: isoTimestamp(schema.webhookEndpoint.createdAt),
};

/** Webhook endpoints of a repository or an organization, and their delivery log. Admins only. */
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

  async ofRepository({
    username,
    repo,
    requesterId,
  }: {
    username: string;
    repo: string;
    requesterId: string;
  }): Promise<WebhookOwner> {
    const repository = await this.access.authorize({
      username,
      repo,
      requesterId: requesterId,
      operation: 'admin',
    });
    return { repositoryId: repository.id, name: `${username}/${repo}` };
  }

  async ofOrganization({
    slug,
    requesterId,
  }: {
    slug: string;
    requesterId: string;
  }): Promise<WebhookOwner> {
    const { organizationId } = await administeredOrganization(
      this.db,
      slug,
      requesterId,
    );
    return { organizationId, name: slug };
  }

  async list(owner: WebhookOwner) {
    const webhooks = await this.db
      .select(webhookColumns)
      .from(schema.webhookEndpoint)
      .where(ownedBy(owner))
      .orderBy(schema.webhookEndpoint.createdAt);
    return { webhooks };
  }

  /** Sends the new endpoint a `ping`. The response is the only time anyone sees its secret. */
  async create(
    owner: WebhookOwner,
    { url, events }: { url: string; events: WebhookEvent[] },
  ) {
    if (!this.key) throw new WebhooksNotConfiguredError();
    await this.checkUrl(url);

    const secret = newWebhookSecret();
    const [webhook] = await this.db
      .insert(schema.webhookEndpoint)
      .values({
        repositoryId: 'repositoryId' in owner ? owner.repositoryId : null,
        organizationId: 'organizationId' in owner ? owner.organizationId : null,
        url,
        secret: sealWebhookSecret(this.key, secret),
        events: [...new Set(events)],
      })
      .returning(webhookColumns);
    await this.fanout.ping(webhook, owner);
    return { ...webhook, secret };
  }

  async update(
    owner: WebhookOwner,
    webhookId: string,
    changes: { url?: string; events?: WebhookEvent[]; active?: boolean },
  ) {
    await this.find(owner, webhookId);
    if (changes.url !== undefined) await this.checkUrl(changes.url);

    const [webhook] = await this.db
      .update(schema.webhookEndpoint)
      .set({
        url: changes.url,
        events: changes.events && [...new Set(changes.events)],
        active: changes.active,
        // turning it back on is the owner saying the problem is fixed
        ...(changes.active === true && {
          disabledReason: null,
          disabledNotifiedAt: null,
        }),
      })
      .where(eq(schema.webhookEndpoint.id, webhookId))
      .returning(webhookColumns);
    return webhook;
  }

  /** Pending deliveries go with it. */
  async remove(owner: WebhookOwner, webhookId: string) {
    await this.find(owner, webhookId);
    await this.db
      .delete(schema.webhookEndpoint)
      .where(eq(schema.webhookEndpoint.id, webhookId));
  }

  /** No overlap: a delivery sent from now on, retries included, is signed with the new secret. */
  async rollSecret(owner: WebhookOwner, webhookId: string) {
    if (!this.key) throw new WebhooksNotConfiguredError();
    await this.find(owner, webhookId);
    const secret = newWebhookSecret();
    await this.db
      .update(schema.webhookEndpoint)
      .set({ secret: sealWebhookSecret(this.key, secret) })
      .where(eq(schema.webhookEndpoint.id, webhookId));
    return { secret };
  }

  async ping(owner: WebhookOwner, webhookId: string) {
    await this.fanout.ping(await this.find(owner, webhookId), owner);
  }

  async deliveries(owner: WebhookOwner, webhookId: string) {
    await this.find(owner, webhookId);
    const deliveries = await this.db
      .select({
        id: schema.deliveryJob.id,
        event: sql<string>`${schema.deliveryJob.payload}->>'event'`,
        status: schema.deliveryJob.status,
        body: sql<string>`${schema.deliveryJob.payload}->>'body'`,
        createdAt: isoTimestamp(schema.deliveryJob.createdAt),
        nextAttemptAt: sql<
          string | null
        >`case when ${schema.deliveryJob.status} = 'pending' then ${isoTimestamp(schema.deliveryJob.nextAttemptAt)} end`,
        attempts: sql<DeliveryAttemptDTO[]>`coalesce((
          select json_agg(json_build_object(
            'startedAt', ${isoTimestamp(sql`a.started_at`)},
            'durationMs', a.duration_ms,
            'statusCode', a.status_code,
            'error', a.error,
            'requestHeaders', a.request_headers,
            'responseBody', a.response_body
          ) order by a.started_at desc)
          from ${schema.deliveryAttempt} a
          where a.job_id = ${schema.deliveryJob}.id
        ), '[]'::json)`,
      })
      .from(schema.deliveryJob)
      .where(eq(schema.deliveryJob.endpointId, webhookId))
      .orderBy(desc(schema.deliveryJob.createdAt))
      .limit(DELIVERY_LOG_LENGTH);
    return { deliveries };
  }

  /** The same body again as a new delivery, with its own id and a fresh round of retries. */
  async redeliver(owner: WebhookOwner, webhookId: string, deliveryId: string) {
    await this.find(owner, webhookId);
    const [delivery] = await this.db
      .select({
        event: sql<string>`${schema.deliveryJob.payload}->>'event'`,
        body: sql<string>`${schema.deliveryJob.payload}->>'body'`,
      })
      .from(schema.deliveryJob)
      .where(
        and(
          eq(schema.deliveryJob.id, deliveryId),
          eq(schema.deliveryJob.endpointId, webhookId),
        ),
      );
    if (!delivery) throw new DeliveryNotFoundError();
    await this.fanout.enqueue([
      {
        endpointId: webhookId,
        ...delivery,
        idempotencyKey: `redeliver:${deliveryId}:${randomUUID()}`,
      },
    ]);
  }

  private async find(owner: WebhookOwner, webhookId: string) {
    const [webhook] = await this.db
      .select(webhookColumns)
      .from(schema.webhookEndpoint)
      .where(and(eq(schema.webhookEndpoint.id, webhookId), ownedBy(owner)));
    if (!webhook) throw new WebhookNotFoundError();
    return webhook;
  }

  private async checkUrl(url: string) {
    const problem = await webhookUrlProblem(url, this.allowPrivate);
    if (problem) throw new InvalidWebhookUrlError(problem);
  }
}

function ownedBy(owner: WebhookOwner) {
  return 'repositoryId' in owner
    ? eq(schema.webhookEndpoint.repositoryId, owner.repositoryId)
    : eq(schema.webhookEndpoint.organizationId, owner.organizationId);
}
