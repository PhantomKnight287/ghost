import { type Database, schema } from '@ghost/db';
import { administers, organizationRoleOf } from '@ghost/permissions';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { repositoryFullNameOf } from '../../lib/git/repository-access/repository-access.js';
import { MailService } from '../../mail/mail.service.js';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Runs in the API rather than apps/delivery because it emails people, and delivery never reads users. */
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
      this.sweep().catch((error: unknown) =>
        this.logger.error(
          `Webhook upkeep failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }, SWEEP_INTERVAL_MS);
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  async sweep() {
    await this.disableFailingEndpoints();
    await this.notifyDisabled();
    await this.pruneOutbox();
  }

  /** Off once a delivery gave up (three days of retries) since the owner last changed the endpoint, with nothing delivered in those three days. */
  async disableFailingEndpoints() {
    return this.db
      .update(schema.webhookEndpoint)
      .set({
        active: false,
        disabledReason: 'Every delivery failed for three days.',
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
      .returning({ id: schema.webhookEndpoint.id });
  }

  /** Emails the admins of endpoints Ghost turned off, here or in apps/delivery on a 410. Claiming the row before sending means one email however many API instances sweep. */
  async notifyDisabled() {
    const disabled = await this.db
      .update(schema.webhookEndpoint)
      .set({ disabledNotifiedAt: new Date() })
      .where(
        and(
          eq(schema.webhookEndpoint.active, false),
          isNotNull(schema.webhookEndpoint.disabledReason),
          isNull(schema.webhookEndpoint.disabledNotifiedAt),
        ),
      )
      .returning({
        id: schema.webhookEndpoint.id,
        url: schema.webhookEndpoint.url,
        reason: sql<string>`${schema.webhookEndpoint.disabledReason}`,
        ownerId: sql<string>`coalesce(${schema.webhookEndpoint.repositoryId}, ${schema.webhookEndpoint.organizationId})`,
      });
    if (disabled.length === 0) return;

    const ownerIds = disabled.map((endpoint) => endpoint.ownerId);
    // ponytail: a user's repository emails its owner only, not collaborators with admin; add them if owners turn out not to be the ones who set webhooks up.
    const [repositoryOwners, organizationMembers] = await Promise.all([
      this.db
        .select({
          ownerId: schema.repository.id,
          owner: repositoryFullNameOf(
            schema.user,
            schema.organization,
            schema.repository,
          ),
          name: schema.user.name,
          email: schema.user.email,
        })
        .from(schema.repository)
        .innerJoin(
          schema.user,
          and(
            eq(schema.user.id, schema.repository.ownerId),
            eq(schema.user.emailVerified, true),
          ),
        )
        .leftJoin(
          schema.organization,
          eq(schema.organization.id, schema.repository.organizationId),
        )
        .where(inArray(schema.repository.id, ownerIds)),
      this.db
        .select({
          ownerId: schema.organization.id,
          owner: schema.organization.slug,
          name: schema.user.name,
          email: schema.user.email,
          role: schema.member.role,
        })
        .from(schema.organization)
        .innerJoin(
          schema.member,
          eq(schema.member.organizationId, schema.organization.id),
        )
        .innerJoin(
          schema.user,
          and(
            eq(schema.user.id, schema.member.userId),
            eq(schema.user.emailVerified, true),
          ),
        )
        .where(inArray(schema.organization.id, ownerIds)),
    ]);
    const recipients = [
      ...repositoryOwners,
      ...organizationMembers.filter((member) =>
        administers(organizationRoleOf(member.role)),
      ),
    ];

    for (const endpoint of disabled) {
      for (const recipient of recipients) {
        if (recipient.ownerId !== endpoint.ownerId) continue;
        await this.mail
          .sendWebhookDisabledEmail(recipient.email, {
            name: recipient.name,
            owner: recipient.owner,
            url: endpoint.url,
            reason: endpoint.reason,
            webhookId: endpoint.id,
          })
          .catch((error: unknown) =>
            this.logger.warn(
              `Emailing ${recipient.email} about webhook ${endpoint.id} failed: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
      }
    }
  }

  /** Handled events are history once every consumer has run; nothing reads them after a month. */
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
