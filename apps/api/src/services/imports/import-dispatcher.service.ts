import { type Database, schema } from '@ghost/db';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import type { Auth } from '../../lib/auth.js';
import { repositoryFullNameOf } from '../../lib/git/repository-access/repository-access.js';
import {
  dispatchToImporter,
  githubImportConfig,
  retryDelayMs,
} from '../../lib/imports/importer.js';
import { githubAccessToken } from '../../lib/imports/github-account.js';
import { StaleImportAttemptError } from '../../lib/imports/imports.errors.js';

// The importer calls back at least every 30 seconds while it works; four missed beats means it is gone.
const LEASE_MS = 2 * 60_000;
const TICK_MS = 30_000;
const CLAIM_BATCH = 10;
export const MAX_IMPORT_ATTEMPTS = 6;
// Covers the slowest import seen end to end; an attempt that outlives it is retried by lease long before the key matters.
const PUSH_KEY_TTL_SECONDS = 24 * 60 * 60;

type Claimed = {
  id: string;
  repositoryId: string;
  requestedById: string;
  source: string;
  claimToken: string;
  attempts: number;
  apiKeyId: string | null;
};

export type AttemptOutcome =
  | { succeeded: true; defaultBranch: string | null }
  | { succeeded: false; error: string; retryable: boolean };

/** Hands each pending import to the importer and retries it when the importer refuses it, reports a retryable failure, or stops calling back. */
@Injectable()
export class ImportDispatcherService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ImportDispatcherService.name);
  private timer?: NodeJS.Timeout;
  private ticking?: Promise<void>;
  private rerun = false;
  private stopped = false;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly auth: AuthService<Auth>,
  ) {}

  onApplicationBootstrap() {
    if (githubImportConfig(this.config)) this.wake();
  }

  async onApplicationShutdown() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.ticking;
  }

  /** Polls only while an import is unfinished, so an idle instance makes no database traffic and can sleep. */
  wake() {
    if (this.stopped) return;
    if (this.ticking) {
      this.rerun = true;
      return;
    }
    clearTimeout(this.timer);
    this.ticking = this.tick()
      .catch((error: unknown) => {
        this.logger.error(
          `Dispatching imports failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return true;
      })
      .then((active) => {
        this.ticking = undefined;
        if (this.rerun) {
          this.rerun = false;
          this.wake();
        } else if (active && !this.stopped) {
          this.timer = setTimeout(() => this.wake(), TICK_MS);
        }
      });
  }

  /** Returns whether any import is still pending or running. */
  async tick(): Promise<boolean> {
    await this.abandonSilent();
    const claimed = await this.claim();
    await Promise.all(claimed.map((row) => this.dispatch(row)));

    const [active] = await this.db
      .select({ id: schema.repositoryImport.id })
      .from(schema.repositoryImport)
      .where(inArray(schema.repositoryImport.status, ['pending', 'running']))
      .limit(1);
    return Boolean(active);
  }

  /** Every importer callback goes through here: a stale attempt is refused, a current one keeps its lease. */
  async renewLease(importId: string, attempt: string) {
    const [row] = await this.db
      .update(schema.repositoryImport)
      .set({ leaseUntil: sql`now() + ${LEASE_MS} * interval '1 millisecond'` })
      .where(this.current(importId, attempt))
      .returning({ repositoryId: schema.repositoryImport.repositoryId });
    if (!row) throw new StaleImportAttemptError();
    return row.repositoryId;
  }

  async settle(importId: string, attempt: string, outcome: AttemptOutcome) {
    const [row] = await this.db
      .select({
        repositoryId: schema.repositoryImport.repositoryId,
        attempts: schema.repositoryImport.attempts,
        apiKeyId: schema.repositoryImport.apiKeyId,
      })
      .from(schema.repositoryImport)
      .where(this.current(importId, attempt));
    if (!row) throw new StaleImportAttemptError();

    if (outcome.succeeded) {
      await this.db.transaction(async (tx) => {
        await tx
          .update(schema.repositoryImport)
          .set({ status: 'succeeded', apiKeyId: null, lastError: null })
          .where(this.current(importId, attempt));
        if (outcome.defaultBranch) {
          await tx
            .update(schema.repository)
            .set({ defaultBranch: outcome.defaultBranch })
            .where(eq(schema.repository.id, row.repositoryId));
        }
      });
    } else {
      const retry =
        outcome.retryable && row.attempts < MAX_IMPORT_ATTEMPTS
          ? retryDelayMs(row.attempts)
          : null;
      await this.db
        .update(schema.repositoryImport)
        .set({
          status: retry === null ? 'failed' : 'pending',
          nextAttemptAt: sql`now() + ${retry ?? 0} * interval '1 millisecond'`,
          lastError: outcome.error,
          apiKeyId: null,
        })
        .where(this.current(importId, attempt));
      if (retry !== null) this.wake();
    }
    await this.revokeKey(row.apiKeyId);
  }

  private current(importId: string, attempt: string) {
    return and(
      eq(schema.repositoryImport.id, importId),
      eq(schema.repositoryImport.claimToken, attempt),
      eq(schema.repositoryImport.status, 'running'),
    );
  }

  /** A silent attempt that used its last try fails here; one with tries left is picked up again by `claim`. */
  private async abandonSilent() {
    // Updating from a locked subquery lets `returning` read the key id the update clears.
    const { rows } = await this.db.execute<{ apiKeyId: string | null }>(sql`
      update ${schema.repositoryImport} set
        status = 'failed',
        last_error = 'The importer stopped responding',
        api_key_id = null,
        updated_at = now()
      from (
        select id, api_key_id from ${schema.repositoryImport}
        where status = 'running' and lease_until < now() and attempts >= ${MAX_IMPORT_ATTEMPTS}
        for update skip locked
      ) as old
      where ${schema.repositoryImport.id} = old.id
      returning old.api_key_id as "apiKeyId"
    `);
    for (const { apiKeyId } of rows) await this.revokeKey(apiKeyId);
  }

  private async claim(): Promise<Claimed[]> {
    const due = sql`(
      (${schema.repositoryImport.status} = 'pending' and ${schema.repositoryImport.nextAttemptAt} <= now())
      or (${schema.repositoryImport.status} = 'running' and ${schema.repositoryImport.leaseUntil} < now())
    ) and ${schema.repositoryImport.attempts} < ${MAX_IMPORT_ATTEMPTS}`;

    const { rows } = await this.db.execute<Claimed>(sql`
      update ${schema.repositoryImport} set
        status = 'running',
        attempts = attempts + 1,
        claim_token = gen_random_uuid(),
        lease_until = now() + ${LEASE_MS} * interval '1 millisecond',
        last_error = case when status = 'running' then 'The importer stopped responding' else last_error end,
        updated_at = now()
      where id in (
        select id from ${schema.repositoryImport} where ${due}
        order by next_attempt_at limit ${CLAIM_BATCH} for update skip locked
      )
      returning id, repository_id as "repositoryId", requested_by_id as "requestedById", source, claim_token as "claimToken", attempts, api_key_id as "apiKeyId"
    `);
    return rows;
  }

  private async dispatch(row: Claimed) {
    const config = githubImportConfig(this.config);
    if (!config) return;

    // A silent attempt's key is still live; the new attempt gets its own.
    await this.revokeKey(row.apiKeyId);

    try {
      const githubToken = await githubAccessToken(
        this.db,
        this.auth,
        row.requestedById,
      );
      if (!githubToken) {
        await this.settle(row.id, row.claimToken, {
          succeeded: false,
          error:
            'The GitHub account that started this import is no longer connected. Connect it again, then retry.',
          retryable: false,
        });
        return;
      }

      const key = await this.auth.api.createApiKey({
        body: {
          userId: row.requestedById,
          name: 'GitHub import',
          expiresIn: PUSH_KEY_TTL_SECONDS,
        },
      });
      await this.db
        .update(schema.repositoryImport)
        .set({ apiKeyId: key.id })
        .where(this.current(row.id, row.claimToken));

      await dispatchToImporter(config, {
        importId: row.id,
        attempt: row.claimToken,
        source: row.source,
        destination: await this.destinationOf(row.repositoryId),
        githubToken,
        ghostToken: key.key,
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.cause instanceof Error
          ? error.cause
          : error;
      this.logger.warn(
        `Import ${row.id} attempt ${row.attempts} was not dispatched: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
      await this.settle(row.id, row.claimToken, {
        succeeded: false,
        error: 'The import could not be started',
        retryable: true,
      }).catch((settleError: unknown) => {
        if (!(settleError instanceof StaleImportAttemptError))
          throw settleError;
      });
    }
  }

  private async destinationOf(repositoryId: string) {
    const [row] = await this.db
      .select({
        fullName: repositoryFullNameOf(
          schema.user,
          schema.organization,
          schema.repository,
        ),
      })
      .from(schema.repository)
      .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
      .leftJoin(
        schema.organization,
        eq(schema.organization.id, schema.repository.organizationId),
      )
      .where(eq(schema.repository.id, repositoryId));
    return row.fullName;
  }

  private async revokeKey(apiKeyId: string | null) {
    if (!apiKeyId) return;
    await this.db.delete(schema.apikey).where(eq(schema.apikey.id, apiKeyId));
  }
}
