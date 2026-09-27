import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, gt, or, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import type { Executor } from '../../lib/issues/close-issue.js';
import {
  DEFAULT_RELEASE_ASSET_MAX_BYTES,
  RELEASE_ASSET_CEILING,
} from '../../lib/releases/release-assets.js';
import { parseByteSize } from '../../lib/storage/byte-size.js';
import {
  billedTo,
  type StorageAccount,
  storageAccountKey,
} from '../../lib/storage/storage-account.js';
import { StorageQuotaExceededError } from '../../lib/storage/storage.errors.js';

/** How long an `uploading` reservation counts before it is taken for an upload that died with its process. */
const RESERVATION_TTL = sql`interval '1 day'`;

/**
 * Bytes an account may keep in object storage. `STORAGE_QUOTA_BYTES` sets one limit for every account; unset, nothing is limited, which is what a self-hosted instance gets by default.
 *
 * Usage is summed from the rows that hold the files, never kept as a counter, so it cannot drift from what is stored and follows a repository when it is transferred.
 */
@Injectable()
export class StorageQuotaService {
  private readonly quota: number | null;
  /** Largest single release asset, from `RELEASE_ASSET_MAX_BYTES`; 2 GB unless set, and never past what one upload can carry. */
  readonly maxAssetBytes: number;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    config: ConfigService,
  ) {
    this.quota = parseByteSize(
      config.get<string>('STORAGE_QUOTA_BYTES'),
      'STORAGE_QUOTA_BYTES',
    );
    this.maxAssetBytes = Math.min(
      parseByteSize(
        config.get<string>('RELEASE_ASSET_MAX_BYTES'),
        'RELEASE_ASSET_MAX_BYTES',
      ) ?? DEFAULT_RELEASE_ASSET_MAX_BYTES,
      RELEASE_ASSET_CEILING,
    );
  }

  /** The limit for `account`, or null for none. Per-account overrides, such as a paid plan, belong here. */
  quotaOf(_account: StorageAccount) {
    return this.quota;
  }

  async usageOf(account: StorageAccount, executor: Executor = this.db) {
    const [row] = await executor
      .select({
        used: sql<string>`coalesce(sum(${schema.releaseAsset.size}), 0)`,
      })
      .from(schema.releaseAsset)
      .innerJoin(
        schema.repository,
        eq(schema.repository.id, schema.releaseAsset.repositoryId),
      )
      .where(
        and(
          billedTo(account),
          or(
            eq(schema.releaseAsset.state, 'uploaded'),
            gt(schema.releaseAsset.createdAt, sql`now() - ${RESERVATION_TTL}`),
          ),
        ),
      );
    return Number(row?.used ?? 0);
  }

  /** Runs `insert`, which must write the row that holds `bytes`, only if the account has room for them. Reservations for one account are serialized, so two uploads cannot both fit into the last free space. */
  reserve<T>(
    account: StorageAccount,
    bytes: number,
    insert: (tx: Executor) => Promise<T>,
  ) {
    return this.db.transaction(async (tx) => {
      const quota = this.quotaOf(account);
      if (quota !== null) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${storageAccountKey(account)}))`,
        );
        const used = await this.usageOf(account, tx);
        if (used + bytes > quota) {
          throw new StorageQuotaExceededError(used, quota, bytes);
        }
      }
      return insert(tx);
    });
  }
}
