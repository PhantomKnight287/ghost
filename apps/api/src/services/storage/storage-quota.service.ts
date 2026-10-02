import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, gt, ne, or, sql } from 'drizzle-orm';

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
import {
  PullRefWriteTooLargeError,
  StorageQuotaExceededError,
  UnmergedPullRefQuotaExceededError,
} from '../../lib/storage/storage.errors.js';

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
  /** Most one update of a request's `refs/pull/*` may add to its base log, from `PULL_REF_MAX_BYTES`; unset, nothing is limited. */
  private readonly maxPullRefWriteBytes: number | null;
  /** Most an author's unmerged requests may hold in base logs altogether, from `PULL_REF_UNMERGED_MAX_BYTES`; unset, nothing is limited. */
  private readonly maxUnmergedPullRefBytes: number | null;

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
    this.maxPullRefWriteBytes = parseByteSize(
      config.get<string>('PULL_REF_MAX_BYTES'),
      'PULL_REF_MAX_BYTES',
    );
    this.maxUnmergedPullRefBytes = parseByteSize(
      config.get<string>('PULL_REF_UNMERGED_MAX_BYTES'),
      'PULL_REF_UNMERGED_MAX_BYTES',
    );
  }

  /** The limit for `account`, or null for none. Per-account overrides, such as a paid plan, belong here. */
  quotaOf(_account: StorageAccount) {
    return this.quota;
  }

  async usageOf(account: StorageAccount, executor: Executor = this.db) {
    const [assets] = await executor
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
    // A request's head starts counting against the base repository once it merges, never before.
    const [pullRefs] = await executor
      .select({
        used: sql<string>`coalesce(sum(${schema.pullRequestRefWrite.size}), 0)`,
      })
      .from(schema.pullRequestRefWrite)
      .innerJoin(
        schema.pullRequest,
        eq(schema.pullRequest.id, schema.pullRequestRefWrite.pullRequestId),
      )
      .innerJoin(
        schema.repository,
        eq(schema.repository.id, schema.pullRequest.baseRepositoryId),
      )
      .where(and(billedTo(account), eq(schema.pullRequest.state, 'merged')));
    return Number(assets?.used ?? 0) + Number(pullRefs?.used ?? 0);
  }

  /** Bytes Ghost has written into base logs for `authorId`'s requests that never merged, open or closed. */
  async unmergedPullRefBytesOf(authorId: string, executor: Executor = this.db) {
    const [row] = await executor
      .select({
        used: sql<string>`coalesce(sum(${schema.pullRequestRefWrite.size}), 0)`,
      })
      .from(schema.pullRequestRefWrite)
      .innerJoin(
        schema.pullRequest,
        eq(schema.pullRequest.id, schema.pullRequestRefWrite.pullRequestId),
      )
      .innerJoin(schema.issue, eq(schema.issue.id, schema.pullRequest.issueId))
      .where(
        and(
          eq(schema.issue.authorId, authorId),
          ne(schema.pullRequest.state, 'merged'),
        ),
      );
    return Number(row?.used ?? 0);
  }

  /** Runs `write`, which must commit the entry and record its row, only if neither pull ref limit refuses `bytes`. Writes for one author are serialized, so two syncs cannot both fit into the last free space. */
  async reservePullRefWrite<T>(
    authorId: string,
    bytes: number,
    write: (tx: Executor) => Promise<T>,
  ) {
    if (
      this.maxPullRefWriteBytes !== null &&
      bytes > this.maxPullRefWriteBytes
    ) {
      throw new PullRefWriteTooLargeError(bytes, this.maxPullRefWriteBytes);
    }
    return this.db.transaction(async (tx) => {
      const limit = this.maxUnmergedPullRefBytes;
      if (limit !== null) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`pull-refs:${authorId}`}))`,
        );
        const used = await this.unmergedPullRefBytesOf(authorId, tx);
        if (used + bytes > limit) {
          throw new UnmergedPullRefQuotaExceededError(used, limit, bytes);
        }
      }
      return write(tx);
    });
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
