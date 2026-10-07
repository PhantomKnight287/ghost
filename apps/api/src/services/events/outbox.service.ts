import { type Database, type Pool, schema } from '@ghost/db';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import {
  DATABASE,
  DATABASE_CONNECTION,
} from '../../database/database.module.js';
import { OUTBOX_CHANNEL, type StoredEvent } from '../../lib/events/events.js';
import { NotifierService } from '../notifications/notifier.service.js';
import { WebhookFanoutService } from '../webhooks/webhook-fanout.service.js';
import { errorMessage } from '../../lib/error-message.js';

const BATCH_SIZE = 20;
// Only retries failed events: new ones arrive by NOTIFY. Longer than Railway's 10 idle minutes, so the API can sleep.
const RETRY_INTERVAL_MS = 15 * 60 * 1000;
const RECONNECT_DELAY_MS = 5000;
// After this many failures an event is set aside with its last error rather than retried forever.
const MAX_ATTEMPTS = 5;

type Listener = {
  release(destroy: boolean): void;
  removeAllListeners(event: 'notification'): unknown;
};

/** Hands each committed event to every consumer, at least once and oldest first. A consumer added later, such as webhook delivery, is one more call in `dispatch`. */
@Injectable()
export class OutboxService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(OutboxService.name);
  private timer?: NodeJS.Timeout;
  private draining?: Promise<void>;
  private listener?: Listener;
  private reconnect?: NodeJS.Timeout;
  private rerun = false;
  private stopped = false;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly notifier: NotifierService,
    private readonly webhooks: WebhookFanoutService,
    @Inject(DATABASE_CONNECTION)
    private readonly connection: { pool: Pool },
  ) {}

  async onApplicationBootstrap() {
    this.timer = setInterval(() => this.wake(), RETRY_INTERVAL_MS);
    await this.listen();
  }

  async onApplicationShutdown() {
    this.stopped = true;
    clearInterval(this.timer);
    clearTimeout(this.reconnect);
    this.dropListener();
    await this.draining;
  }

  /** An idle LISTEN connection sends nothing, unlike polling, so it does not keep the container awake. */
  private async listen() {
    this.reconnect = undefined;
    if (this.stopped) return;
    try {
      const client = await this.connection.pool.connect();
      if (this.stopped) {
        client.release();
        return;
      }
      this.listener = client;
      client.on('notification', () => this.wake());
      client.on('error', (error) => {
        // stays attached after a drop, so a late error on a destroyed client cannot crash the process
        if (this.listener !== client) return;
        this.logger.warn(`Outbox listener lost: ${error.message}`);
        this.dropListener();
        this.retryListen();
      });
      await client.query(`LISTEN ${OUTBOX_CHANNEL}`);
      // Events committed while nobody listened got no NOTIFY.
      this.wake();
    } catch (error) {
      this.logger.warn(`Outbox listener failed: ${errorMessage(error)}`);
      this.dropListener();
      this.retryListen();
    }
  }

  /** Destroys the connection rather than pooling it: a pooled client would keep the LISTEN and wake the outbox for whoever borrows it next. */
  private dropListener() {
    const client = this.listener;
    if (!client) return;
    this.listener = undefined;
    client.removeAllListeners('notification');
    client.release(true);
  }

  private retryListen() {
    if (this.stopped || this.reconnect) return;
    this.reconnect = setTimeout(() => void this.listen(), RECONNECT_DELAY_MS);
  }

  private wake() {
    if (this.stopped) return;
    // A NOTIFY mid-drain may name a row the drain already looked past.
    if (this.draining) {
      this.rerun = true;
      return;
    }
    this.draining = this.drain()
      .catch((error: unknown) =>
        this.logger.error(`Draining the outbox failed: ${errorMessage(error)}`),
      )
      .finally(() => {
        this.draining = undefined;
        if (this.rerun && !this.stopped) {
          this.rerun = false;
          this.wake();
        }
      });
  }

  /** Works through pending events until a batch comes up short. A failed event waits for the next drain, and does not stop this one reaching the rows behind it. */
  async drain() {
    const failed = new Set<string>();
    while ((await this.processBatch(failed)) === BATCH_SIZE);
  }

  // ponytail: rows stay locked while consumers run, emails included; a lease column would let a slow batch release them sooner.
  private processBatch(failed: Set<string>) {
    return this.db.transaction(async (tx) => {
      const events = await tx
        .select()
        .from(schema.outboxEvent)
        .where(
          and(
            isNull(schema.outboxEvent.processedAt),
            // one array parameter, not one per id, so a long run of failures stays under Postgres's parameter limit
            failed.size
              ? sql`${schema.outboxEvent.id} <> all(${sql.param([...failed])}::text[])`
              : undefined,
          ),
        )
        .orderBy(asc(schema.outboxEvent.createdAt), asc(schema.outboxEvent.id))
        .limit(BATCH_SIZE)
        // several API instances share the outbox: each claims rows the others have not
        .for('update', { skipLocked: true });

      for (const event of events) {
        const attempts = event.attempts + 1;
        try {
          // written by `publishEvent`, which checked the payload against its type
          await this.dispatch(event as unknown as StoredEvent);
          await tx
            .update(schema.outboxEvent)
            .set({ attempts, processedAt: new Date() })
            .where(eq(schema.outboxEvent.id, event.id));
        } catch (error) {
          const message = errorMessage(error);
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
          if (attempts < MAX_ATTEMPTS) failed.add(event.id);
        }
      }
      return events.length;
    });
  }

  private async dispatch(event: StoredEvent) {
    // A retry runs both again; webhook jobs are keyed by event and endpoint, so none is queued twice.
    await this.notifier.handle(event);
    await this.webhooks.handle(event);
  }
}
