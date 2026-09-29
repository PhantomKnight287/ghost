import { type Database, schema } from '@ghost/db';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { ownerNameOf } from '../../lib/git/repository-access/repository-access.js';
import { MailService } from '../../mail/mail.service.js';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Hourly upkeep around webhook delivery: turns off endpoints that only fail, and prunes handled outbox events.
 * Runs in the API rather than apps/delivery because it emails people, and delivery never reads users.
 */
@Injectable()
export class WebhookBreakerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(WebhookBreakerService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly mail: MailService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => {
      Promise.all([this.disableFailingEndpoints(), this.pruneOutbox()]).catch(
        (error: unknown) =>
          this.logger.error(
            `Webhook upkeep failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
      );
    }, SWEEP_INTERVAL_MS);
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  /**
   * An endpoint is off once a delivery gave up (three days of retries) since the owner last changed it, and nothing reached it in those three days.
   * Several API instances may sweep at once: the UPDATE hands each endpoint to one of them, so its owner gets one email.
   */
  async disableFailingEndpoints() {
    const disabled = await this.db
      .update(schema.webhookEndpoint)
      .set({
        active: false,
        disabledReason: 'Every delivery failed for three days.',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.webhookEndpoint.active, true),
          sql`exists (
            select 1 from ${schema.deliveryJob} j
            where j.endpoint_id = ${schema.webhookEndpoint.id}
              and j.status = 'dead'
              and j.updated_at > ${schema.webhookEndpoint.updatedAt}
          )`,
          sql`not exists (
            select 1 from ${schema.deliveryJob} j
            where j.endpoint_id = ${schema.webhookEndpoint.id}
              and j.status = 'succeeded'
              and j.updated_at > now() - interval '3 days'
          )`,
        ),
      )
      .returning({
        id: schema.webhookEndpoint.id,
        url: schema.webhookEndpoint.url,
        repositoryId: schema.webhookEndpoint.repositoryId,
      });
    if (disabled.length === 0) return disabled;

    const repositoryIds = disabled.flatMap((endpoint) =>
      endpoint.repositoryId ? [endpoint.repositoryId] : [],
    );
    // ponytail: only the repository owner hears about it; mail every admin if owners turn out not to be the ones who set webhooks up.
    const owners = repositoryIds.length
      ? await this.db
          .select({
            repositoryId: schema.repository.id,
            repository: sql<string>`${ownerNameOf(schema.user, schema.organization)} || '/' || ${schema.repository.slug}`,
            name: schema.user.name,
            email: schema.user.email,
            emailVerified: schema.user.emailVerified,
          })
          .from(schema.repository)
          .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
          .leftJoin(
            schema.organization,
            eq(schema.organization.id, schema.repository.organizationId),
          )
          .where(inArray(schema.repository.id, repositoryIds))
      : [];

    for (const endpoint of disabled) {
      this.logger.warn(`Turned off failing webhook ${endpoint.id}`);
      const owner = owners.find(
        (row) => row.repositoryId === endpoint.repositoryId,
      );
      if (!owner?.emailVerified) continue;
      await this.mail
        .sendWebhookDisabledEmail(owner.email, {
          name: owner.name,
          repository: owner.repository,
          url: endpoint.url,
          webhookId: endpoint.id,
        })
        .catch((error: unknown) =>
          this.logger.warn(
            `Emailing about webhook ${endpoint.id} failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    }
    return disabled;
  }

  /** Handled events are only history once every consumer has run; nothing reads them after a month. */
  async pruneOutbox() {
    await this.db
      .delete(schema.outboxEvent)
      .where(
        and(
          isNotNull(schema.outboxEvent.processedAt),
          lt(schema.outboxEvent.processedAt, sql`now() - interval '30 days'`),
        ),
      );
  }
}
