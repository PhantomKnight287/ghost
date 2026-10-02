import path from 'node:path';
import { createDatabase, type Database, type Pool, schema } from '@ghost/db';
import { ConfigService } from '@nestjs/config';
import { inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  MergeStorageQuotaExceededError,
  PullRefWriteTooLargeError,
  UnmergedPullRefQuotaExceededError,
} from '../../lib/storage/storage.errors.js';
import { StorageQuotaService } from './storage-quota.service.js';

const CONNECTION = process.env.TEST_DATABASE_URL;
const MIGRATIONS = path.resolve(
  import.meta.dirname,
  '../../../../../packages/db/drizzle',
);

const OWNER = 'user_pull_ref_owner';
const AUTHOR = 'user_pull_ref_author';

// Needs a throwaway Postgres; the suite is skipped without one.
describe.skipIf(!CONNECTION)('pull request ref bytes', () => {
  let db: Database;
  let pool: Pool;
  let repositoryId: string;
  let number = 0;

  const quotaWith = (env: Record<string, string>) =>
    new StorageQuotaService(db, new ConfigService(env));

  /** A request by AUTHOR into OWNER's repository that Ghost has already written `size` bytes for. */
  async function requestHolding(
    state: 'open' | 'closed' | 'merged',
    size: number,
  ) {
    number += 1;
    const [issue] = await db
      .insert(schema.issue)
      .values({
        repositoryId,
        number,
        title: `request ${number}`,
        authorId: AUTHOR,
        isPullRequest: true,
        state: state === 'open' ? 'open' : 'closed',
      })
      .returning();
    const [pullRequest] = await db
      .insert(schema.pullRequest)
      .values({
        issueId: issue.id,
        state,
        baseRepositoryId: repositoryId,
        baseRef: 'main',
        headRepositoryId: repositoryId,
        headRef: `branch-${number}`,
        headSha: '0'.repeat(40),
      })
      .returning();
    await db
      .insert(schema.pullRequestRefWrite)
      .values({ pullRequestId: pullRequest.id, size });
  }

  beforeAll(async () => {
    ({ db, pool } = createDatabase({ connectionString: CONNECTION! }));
    await migrate(db, { migrationsFolder: MIGRATIONS });
  });

  beforeEach(async () => {
    await db
      .delete(schema.user)
      .where(inArray(schema.user.id, [OWNER, AUTHOR]));
    await db.insert(schema.user).values([
      {
        id: OWNER,
        name: 'Owner',
        email: 'pull-ref-owner@example.com',
        username: 'pull-ref-owner',
      },
      {
        id: AUTHOR,
        name: 'Author',
        email: 'pull-ref-author@example.com',
        username: 'pull-ref-author',
      },
    ]);
    [{ id: repositoryId }] = await db
      .insert(schema.repository)
      .values({
        name: 'app',
        slug: 'app',
        ownerId: OWNER,
        visibility: 'public',
      })
      .returning();
  });

  afterAll(async () => {
    await db
      .delete(schema.user)
      .where(inArray(schema.user.id, [OWNER, AUTHOR]));
    await pool?.end();
  });

  it('bills the base account only for requests that merged', async () => {
    await requestHolding('open', 100);
    await requestHolding('closed', 200);
    await requestHolding('merged', 400);

    expect(await quotaWith({}).usageOf({ userId: OWNER })).toBe(400);
    expect(await quotaWith({}).usageOf({ userId: AUTHOR })).toBe(0);
  });

  it('counts an author against open and closed requests, never merged ones', async () => {
    await requestHolding('open', 100);
    await requestHolding('closed', 200);
    await requestHolding('merged', 400);

    expect(await quotaWith({}).unmergedPullRefBytesOf(AUTHOR)).toBe(300);
  });

  it('refuses a single update past PULL_REF_MAX_BYTES without opening a transaction', async () => {
    const write = vi.fn();

    await expect(
      quotaWith({ PULL_REF_MAX_BYTES: '1kb' }).reservePullRefWrite(
        AUTHOR,
        1025,
        write,
      ),
    ).rejects.toBeInstanceOf(PullRefWriteTooLargeError);
    expect(write).not.toHaveBeenCalled();
  });

  it('refuses an update that would take the author past PULL_REF_UNMERGED_MAX_BYTES', async () => {
    await requestHolding('closed', 900);
    const write = vi.fn();

    await expect(
      quotaWith({ PULL_REF_UNMERGED_MAX_BYTES: '1000' }).reservePullRefWrite(
        AUTHOR,
        101,
        write,
      ),
    ).rejects.toBeInstanceOf(UnmergedPullRefQuotaExceededError);
    expect(write).not.toHaveBeenCalled();
  });

  it('runs the write when it fits', async () => {
    await requestHolding('merged', 5000);
    const write = vi.fn().mockResolvedValue('written');

    expect(
      await quotaWith({
        PULL_REF_MAX_BYTES: '1000',
        PULL_REF_UNMERGED_MAX_BYTES: '1000',
      }).reservePullRefWrite(AUTHOR, 1000, write),
    ).toBe('written');
  });

  it('lets a merge through while the account has any room left, however much the request holds', async () => {
    await requestHolding('merged', 999);
    await requestHolding('open', 5000);

    await db.transaction((tx) =>
      quotaWith({ STORAGE_QUOTA_BYTES: '1000' }).assertRoomToMerge(
        { userId: OWNER },
        tx,
      ),
    );
  });

  it('refuses a merge once the account is at its quota', async () => {
    await requestHolding('merged', 1000);

    await expect(
      db.transaction((tx) =>
        quotaWith({ STORAGE_QUOTA_BYTES: '1000' }).assertRoomToMerge(
          { userId: OWNER },
          tx,
        ),
      ),
    ).rejects.toBeInstanceOf(MergeStorageQuotaExceededError);
  });

  it('never refuses a merge without STORAGE_QUOTA_BYTES', async () => {
    await requestHolding('merged', 1_000_000);

    await db.transaction((tx) =>
      quotaWith({}).assertRoomToMerge({ userId: OWNER }, tx),
    );
  });
});
