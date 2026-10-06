import path from 'node:path';
import { createDatabase, type Database, type Pool, schema } from '@ghost/db';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryWalStore } from '../../lib/git/materializer/wal-store.fake.js';
import { createUlid } from '../../lib/git/wal/ulid.js';
import { emptyIndex } from '../../lib/git/wal/wal.types.js';
import type { WalStoreService } from '../git/wal/wal-store.service.js';
import { RepositoryLogBackfillService } from './repository-log-backfill.service.js';

const CONNECTION = process.env.TEST_DATABASE_URL;
const MIGRATIONS = path.resolve(
  import.meta.dirname,
  '../../../../../packages/db/drizzle',
);

const OWNER = 'user_log_backfill_owner';

// Needs a throwaway Postgres; the suite is skipped without one.
describe.skipIf(!CONNECTION)('RepositoryLogBackfillService', () => {
  let db: Database;
  let pool: Pool;
  let wal: InMemoryWalStore;
  let backfill: RepositoryLogBackfillService;
  let repositoryId: string;

  const layer = (ulid: string, size: number) => ({
    ulid,
    size,
    packSha: Buffer.alloc(32),
  });

  beforeAll(async () => {
    ({ db, pool } = createDatabase({ connectionString: CONNECTION! }));
    await migrate(db, { migrationsFolder: MIGRATIONS });
  });

  beforeEach(async () => {
    await db.delete(schema.user).where(eq(schema.user.id, OWNER));
    await db.insert(schema.user).values({
      id: OWNER,
      name: 'Owner',
      email: 'log-backfill-owner@example.com',
      username: 'log-backfill-owner',
    });
    [{ id: repositoryId }] = await db
      .insert(schema.repository)
      .values({ name: 'app', slug: 'app', ownerId: OWNER })
      .returning();
    wal = new InMemoryWalStore();
    backfill = new RepositoryLogBackfillService(
      db,
      wal as unknown as WalStoreService,
    );
  });

  afterAll(async () => {
    await db.delete(schema.user).where(eq(schema.user.id, OWNER));
    await pool?.end();
  });

  it('finds nothing for a repository without a log', async () => {
    expect(await backfill.missingEntries(repositoryId)).toEqual([]);
  });

  it('bills only entries that have no row and were not written for a pull request', async () => {
    const [billed, written, pending, old] = [
      createUlid(),
      createUlid(),
      createUlid(),
      createUlid(),
    ];
    const [issue] = await db
      .insert(schema.issue)
      .values({
        repositoryId,
        number: 1,
        title: 'request',
        authorId: OWNER,
        isPullRequest: true,
      })
      .returning();
    const [pullRequest] = await db
      .insert(schema.pullRequest)
      .values({
        issueId: issue.id,
        baseRepositoryId: repositoryId,
        baseRef: 'main',
        headRepositoryId: repositoryId,
        headRef: 'feature',
        headSha: '0'.repeat(40),
      })
      .returning();
    await db.insert(schema.pullRequestRefWrite).values({
      id: `prw_${written}`,
      pullRequestId: pullRequest.id,
      size: 20,
    });
    await db
      .insert(schema.pullRequestRefWritePending)
      .values({ id: pending, pullRequestId: pullRequest.id });
    await db
      .insert(schema.repositoryLogEntry)
      .values({ repositoryId, ulid: billed, size: 10 });
    await wal.casIndex(
      repositoryId,
      {
        ...emptyIndex(),
        layers: [
          layer(billed, 10),
          layer(written, 20),
          layer(pending, 30),
          layer(old, 40),
        ],
      },
      null,
    );

    const missing = await backfill.missingEntries(repositoryId);
    expect(missing).toEqual([{ repositoryId, ulid: old, size: 40 }]);

    expect(await backfill.record(missing)).toBe(40);
    expect(await backfill.record(missing)).toBe(0);
    expect(await backfill.missingEntries(repositoryId)).toEqual([]);
    expect(
      await db
        .select({ ulid: schema.repositoryLogEntry.ulid })
        .from(schema.repositoryLogEntry)
        .where(eq(schema.repositoryLogEntry.repositoryId, repositoryId)),
    ).toHaveLength(2);
  });
});
