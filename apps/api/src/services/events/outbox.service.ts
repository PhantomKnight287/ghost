import { type Database, schema } from '@ghost/db';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { asc, eq, isNull } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import type { StoredEvent } from '../../lib/events/events.js';
import { NotifierService } from '../notifications/notifier.service.js';
import { WebhookFanoutService } from '../webhooks/webhook-fanout.service.js';

const BATCH_SIZE = 20;
const POLL_INTERVAL_MS = 2000;
// After this many failures an event is set aside with its last error rather than retried forever.
const MAX_ATTEMPTS = 5;

/** Hands each committed event to every consumer, at least once and oldest first. A consumer added later, such as webhook delivery, is one more call in `dispatch`. */
@Injectable()
export class OutboxService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(OutboxService.name);
  private timer?: NodeJS.Timeout;
  private draining?: Promise<void>;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly notifier: NotifierService,
    private readonly webhooks: WebhookFanoutService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => {
      this.draining ??= this.drain()
        .catch((error: unknown) =>
          this.logger.error(
            `Draining the outbox failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        )
        .finally(() => {
          this.draining = undefined;
        });
    }, POLL_INTERVAL_MS);
  }

  async onApplicationShutdown() {
    clearInterval(this.timer);
    await this.draining;
  }

  /** Works through pending events until a batch comes up short. A failed event waits for the next poll. */
  async drain() {
    while ((await this.processBatch()) === BATCH_SIZE);
  }

  // ponytail: rows stay locked while consumers run, emails included; a lease column would let a slow batch release them sooner.
  private processBatch() {
    return this.db.transaction(async (tx) => {
      const events = await tx
        .select()
        .from(schema.outboxEvent)
        .where(isNull(schema.outboxEvent.processedAt))
        .orderBy(asc(schema.outboxEvent.createdAt), asc(schema.outboxEvent.id))
        .limit(BATCH_SIZE)
        // several API instances share the outbox: each claims rows the others have not
        .for('update', { skipLocked: true });

      let handled = 0;
      for (const event of events) {
        const attempts = event.attempts + 1;
        try {
          // written by `publishEvent`, which checked the payload against its type
          await this.dispatch(event as unknown as StoredEvent);
          await tx
            .update(schema.outboxEvent)
            .set({ attempts, processedAt: new Date() })
            .where(eq(schema.outboxEvent.id, event.id));
          handled++;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Event ${event.id} (${event.type}) failed, attempt ${attempts}: ${message}`,
          );
          await tx
            .update(schema.outboxEvent)
            .set({
              attempts,
              lastError: message,
              processedAt: attempts >= MAX_ATTEMPTS ? new Date() : null,
            })
            .where(eq(schema.outboxEvent.id, event.id));
        }
      }
      return handled;
    });
  }

  private async dispatch(event: StoredEvent) {
    // A retry runs both again; webhook jobs are keyed by event and endpoint, so none is queued twice.
    await this.notifier.handle(event);
    await this.webhooks.handle(event);
  }
}
