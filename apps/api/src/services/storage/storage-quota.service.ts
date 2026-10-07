import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, gt, isNotNull, ne, or, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import type { Executor } from '../../lib/db/executor.js';
import { DEFAULT_RELEASE_ASSET_MAX_BYTES } from '../../lib/releases/release-assets.js';
import { PUT_OBJECT_MAX_BYTES } from '../../lib/s3/s3.limits.js';
import { parseByteSize } from '../../lib/storage/byte-size.js';
import { RESERVATION_TTL } from '../../lib/storage/reservation.js';
import {
  MergeStorageQuotaExceededError,
  PullRefWriteTooLargeError,
  StorageQuotaExceededError,
  UnmergedPullRefQuotaExceededError,
} from '../../lib/storage/storage.errors.js';
import {
  billedTo,
  type StorageAccount,
  storageAccountKey,
  type StorageKind,
} from '../../lib/storage/storage-account.js';

type PullRequestState = (typeof schema.pullRequestState.enumValues)[number];

/**
 * Bytes an account may keep in object storage, per {@link StorageKind}. `STORAGE_QUOTA_BYTES`, `FORK_STORAGE_QUOTA_BYTES`, `LFS_STORAGE_QUOTA_BYTES` and `ASSET_STORAGE_QUOTA_BYTES` set the instance's limits, which a `storage_limit` row overrides for one account; unset, nothing is limited, which is what a self-hosted instance gets by default.
 *
 * Usage is summed from the rows that hold the files, never kept as a counter, so it cannot drift from what is stored and follows a repository when it is transferred.
 */
@Injectable()
export class StorageQuotaService {
  private readonly defaults: Record<StorageKind, number | null>;
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
    this.defaults = {
      repository: parseByteSize(
        config.get<string>('STORAGE_QUOTA_BYTES'),
        'STORAGE_QUOTA_BYTES',
      ),
      fork: parseByteSize(
        config.get<string>('FORK_STORAGE_QUOTA_BYTES'),
        'FORK_STORAGE_QUOTA_BYTES',
      ),
      lfs: parseByteSize(
        config.get<string>('LFS_STORAGE_QUOTA_BYTES'),
        'LFS_STORAGE_QUOTA_BYTES',
      ),
      asset: parseByteSize(
        config.get<string>('ASSET_STORAGE_QUOTA_BYTES'),
        'ASSET_STORAGE_QUOTA_BYTES',
      ),
    };
    this.maxAssetBytes = Math.min(
      parseByteSize(
        config.get<string>('RELEASE_ASSET_MAX_BYTES'),
        'RELEASE_ASSET_MAX_BYTES',
      ) ?? DEFAULT_RELEASE_ASSET_MAX_BYTES,
      // assets are uploaded in one PutObject
      PUT_OBJECT_MAX_BYTES,
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

  /** The limit for `account`, or null for none. */
  async quotaOf(
    account: StorageAccount,
    kind: StorageKind,
    executor: Executor = this.db,
  ) {
    const [limit] = await executor
      .select({
        repository: schema.storageLimit.repositoryBytes,
        fork: schema.storageLimit.forkBytes,
        lfs: schema.storageLimit.lfsBytes,
        asset: schema.storageLimit.assetBytes,
      })
      .from(schema.storageLimit)
      .where(
        'organizationId' in account
          ? eq(schema.storageLimit.organizationId, account.organizationId)
          : eq(schema.storageLimit.userId, account.userId),
      );
    return limit?.[kind] ?? this.defaults[kind];
  }

  async usageOf(
    account: StorageAccount,
    kind: StorageKind,
    executor: Executor = this.db,
  ) {
    // A fork's files all count against the fork limit; elsewhere each kind of file has a limit of its own.
    const repositories = billedTo(
      account,
      kind === 'fork' ? 'fork' : 'repository',
    );
    const counts = (file: StorageKind) => kind === 'fork' || kind === file;
    let used = 0;

    if (counts('lfs')) {
      const [lfs] = await executor
        .select({
          used: sql<string>`coalesce(sum(${schema.lfsObject.size}), 0)`,
        })
        .from(schema.lfsObject)
        .innerJoin(
          schema.repository,
          eq(schema.repository.id, schema.lfsObject.repositoryId),
        )
        .where(
          and(
            repositories,
            or(
              isNotNull(schema.lfsObject.uploadedAt),
              gt(schema.lfsObject.createdAt, sql`now() - ${RESERVATION_TTL}`),
            ),
          ),
        );
      used += Number(lfs?.used ?? 0);
    }

    if (counts('asset')) {
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
            repositories,
            or(
              eq(schema.releaseAsset.state, 'uploaded'),
              gt(
                schema.releaseAsset.createdAt,
                sql`now() - ${RESERVATION_TTL}`,
              ),
            ),
          ),
        );
      used += Number(assets?.used ?? 0);
    }

    // Attachments bill whoever uploaded them, wherever they are posted, so commenting on someone else's repository never fills the owner's quota.
    if (kind === 'asset' && 'userId' in account) {
      const [attachments] = await executor
        .select({
          used: sql<string>`coalesce(sum(${schema.attachment.size}), 0)`,
        })
        .from(schema.attachment)
        .where(
          and(
            eq(schema.attachment.uploaderId, account.userId),
            or(
              isNotNull(schema.attachment.uploadedAt),
              gt(schema.attachment.createdAt, sql`now() - ${RESERVATION_TTL}`),
            ),
          ),
        );
      used += Number(attachments?.used ?? 0);
    }

    if (counts('repository')) {
      const [logs] = await executor
        .select({
          used: sql<string>`coalesce(sum(${schema.repositoryLogEntry.size}), 0)`,
        })
        .from(schema.repositoryLogEntry)
        .innerJoin(
          schema.repository,
          eq(schema.repository.id, schema.repositoryLogEntry.repositoryId),
        )
        .where(repositories);
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
        .where(and(repositories, eq(schema.pullRequest.state, 'merged')));
      used += Number(logs?.used ?? 0) + Number(pullRefs?.used ?? 0);
    }

    return used;
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

  /** Runs `write`, which must commit the entry and record its row, only if neither pull ref limit refuses `bytes`. A merged request's bytes bill its base account, so only the per-write limit applies to it. Writes for one author are serialized, so two syncs cannot both fit into the last free space. */
  async reservePullRefWrite<T>(
    { authorId, state }: { authorId: string; state: PullRequestState },
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
      if (limit !== null && state !== 'merged') {
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
    kind: StorageKind,
    bytes: number,
    insert: (tx: Executor) => Promise<T>,
  ) {
    return this.db.transaction(async (tx) => {
      const quota = await this.quotaOf(account, kind, tx);
      // An account past its quota may still write nothing, such as a push that only deletes branches.
      if (quota !== null && bytes > 0) {
        await this.lockAccount(account, kind, tx);
        const used = await this.usageOf(account, kind, tx);
        if (used + bytes > quota) {
          throw new StorageQuotaExceededError(used, quota, bytes);
        }
      }
      return insert(tx);
    });
  }

  /** Refuses a merge once `account` is at or past its quota. A merge needs room left, not room enough: the pull refs it starts billing may carry the account past its quota, and the next merge is the one refused. Run inside the merge's transaction, so merges into one account see each other. */
  async assertRoomToMerge(
    account: StorageAccount,
    kind: StorageKind,
    tx: Executor,
  ) {
    const quota = await this.quotaOf(account, kind, tx);
    if (quota === null) return;
    await this.lockAccount(account, kind, tx);
    const used = await this.usageOf(account, kind, tx);
    if (used >= quota) throw new MergeStorageQuotaExceededError(used, quota);
  }

  private lockAccount(
    account: StorageAccount,
    kind: StorageKind,
    tx: Executor,
  ) {
    return tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${storageAccountKey(account)}:${kind}`}))`,
    );
  }
}
