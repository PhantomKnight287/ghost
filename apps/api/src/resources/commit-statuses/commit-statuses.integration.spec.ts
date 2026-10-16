import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createDatabase, type Database, type Pool, schema } from '@ghost/db';
import { and, eq, inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import {
  InvalidStatusShaError,
  TooManyStatusesError,
} from '../../lib/commit-statuses/commit-statuses.errors.js';
import { InMemoryWalStore } from '../../lib/git/materializer/wal-store.fake.js';
import { bufferBody } from '../../lib/git/protocol/git-request-body.js';
import { ZERO_OID } from '../../lib/git/wal/wal.types.js';
import { RepositoryForbiddenError } from '../../lib/repositories/access/repository-access.errors.js';
import { RepositoryMaterializerService } from '../../services/git/materializer/repository-materializer.service.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import type { RepositoryStorageService } from '../../services/git/repository-storage/repository-storage.service.js';
import { PushTransactionService } from '../../services/git/wal/push-transaction.service.js';
import type { WalStoreService } from '../../services/git/wal/wal-store.service.js';
import { CommitStatusesService } from './commit-statuses.service.js';

const CONNECTION = process.env.TEST_DATABASE_URL;
const MIGRATIONS = path.resolve(
  import.meta.dirname,
  '../../../../../packages/db/drizzle',
);

const OWNER = 'user_status_owner';
const READER = 'user_status_reader';

function git(cwd: string, ...args: string[]) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  return execFileSync('git', args, { cwd, encoding: 'utf8', env }).trim();
}

// Needs a throwaway Postgres; the suite is skipped without one.
describe.skipIf(!CONNECTION)('commit statuses', () => {
  let db: Database;
  let pool: Pool;
  let root: string;
  let statuses: CommitStatusesService;
  let repository: typeof schema.repository.$inferSelect;
  let sha: string;
  let tagSha: string;

  const owner = { username: 'status-owner', repo: 'app', requesterId: OWNER };
  const reader = { ...owner, requesterId: READER };

  beforeAll(async () => {
    ({ db, pool } = createDatabase({ connectionString: CONNECTION }));
    await migrate(db, { migrationsFolder: MIGRATIONS });
  });

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-statuses-'));
    const source = path.join(root, 'source');
    const cache = path.join(root, 'cache.git');
    execFileSync('git', ['init', '-q', '-b', 'main', source]);
    git(source, 'config', 'user.email', 'test@example.com');
    git(source, 'config', 'user.name', 'Test');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', cache]);

    const store = new InMemoryWalStore() as unknown as WalStoreService;
    const materializer = new RepositoryMaterializerService(store, {
      getRepoPath: async () => cache,
    } as unknown as RepositoryStorageService);
    statuses = new CommitStatusesService(
      db,
      new RepositoryAccessService(db),
      materializer,
    );

    await db
      .delete(schema.user)
      .where(inArray(schema.user.id, [OWNER, READER]));
    await db.insert(schema.user).values([
      {
        id: OWNER,
        name: 'Owner',
        email: 'status-owner@example.com',
        username: 'status-owner',
      },
      {
        id: READER,
        name: 'Reader',
        email: 'status-reader@example.com',
        username: 'status-reader',
      },
    ]);
    [repository] = await db
      .insert(schema.repository)
      .values({
        name: 'app',
        slug: 'app',
        ownerId: OWNER,
        visibility: 'public',
      })
      .returning();

    writeFileSync(path.join(source, 'README.md'), 'hello\n');
    git(source, 'add', '-A');
    git(source, 'commit', '-m', 'first');
    sha = git(source, 'rev-parse', 'HEAD');
    git(source, 'tag', '-a', 'v1', '-m', 'release');
    tagSha = git(source, 'rev-parse', 'v1');
    await new PushTransactionService(store).commitPush({
      repoId: repository.id,
      transitions: [
        {
          ref: 'refs/heads/main',
          oldOid: ZERO_OID,
          newOid: Buffer.from(sha, 'hex'),
        },
      ],
      body: bufferBody(
        execFileSync('git', ['pack-objects', '--stdout', '--revs'], {
          cwd: source,
          input: 'HEAD\nrefs/tags/v1\n',
        }),
      ),
      packOffset: 0,
    });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  afterAll(async () => {
    await db
      .delete(schema.user)
      .where(inArray(schema.user.id, [OWNER, READER]));
    await pool?.end();
  });

  it('stores a status and publishes one event carrying its id', async () => {
    const status = await statuses.create({
      ...owner,
      sha,
      body: {
        state: 'pending',
        context: 'ci',
        description: 'Building',
        targetUrl: 'https://ci.example.com/1',
      },
    });

    expect(status).toMatchObject({
      state: 'pending',
      context: 'ci',
      description: 'Building',
      targetUrl: 'https://ci.example.com/1',
      creator: { username: 'status-owner', image: null },
    });
    expect(status.id).toMatch(/^cst_/);
    expect(new Date(status.createdAt).toISOString()).toBe(status.createdAt);
    const events = await db
      .select({ payload: schema.outboxEvent.payload })
      .from(schema.outboxEvent)
      .where(
        and(
          eq(schema.outboxEvent.repositoryId, repository.id),
          eq(schema.outboxEvent.type, 'commit_status.created'),
        ),
      );
    expect(events).toEqual([{ payload: { statusId: status.id } }]);
  });

  it('reads the newest status per context, and keeps the history newest first', async () => {
    await statuses.create({
      ...owner,
      sha,
      body: { state: 'pending', context: 'ci' },
    });
    await statuses.create({
      ...owner,
      sha,
      body: { state: 'success', context: 'ci' },
    });

    expect(await statuses.combined({ ...owner, ref: sha })).toMatchObject({
      sha,
      state: 'success',
      totalCount: 1,
      statuses: [{ state: 'success', context: 'ci' }],
    });
    const page = await statuses.pageStatuses({
      ...owner,
      ref: sha,
      offset: 0,
      limit: 10,
    });
    expect(page.sha).toBe(sha);
    expect(page.total).toBe(2);
    expect(page.statuses.map((status) => status.state)).toEqual([
      'success',
      'pending',
    ]);
  });

  it('fails when any context errored', async () => {
    await statuses.create({
      ...owner,
      sha,
      body: { state: 'success', context: 'ci' },
    });
    await statuses.create({
      ...owner,
      sha,
      body: { state: 'error', context: 'deploy' },
    });

    expect(await statuses.combined({ ...owner, ref: sha })).toMatchObject({
      state: 'failure',
      totalCount: 2,
    });
  });

  it('is pending with nothing to show on a commit without statuses', async () => {
    expect(await statuses.combined({ ...owner, ref: sha })).toEqual({
      sha,
      state: 'pending',
      totalCount: 0,
      statuses: [],
    });
  });

  it('resolves a branch to its tip', async () => {
    await statuses.create({ ...owner, sha, body: { state: 'success' } });

    expect(await statuses.combined({ ...owner, ref: 'main' })).toEqual(
      await statuses.combined({ ...owner, ref: sha }),
    );
  });

  it('refuses an abbreviated sha and one that is not a commit here', async () => {
    await expect(
      statuses.create({
        ...owner,
        sha: sha.slice(0, 8),
        body: { state: 'success' },
      }),
    ).rejects.toThrow(InvalidStatusShaError);
    await expect(
      statuses.create({
        ...owner,
        sha: 'f'.repeat(40),
        body: { state: 'success' },
      }),
    ).rejects.toThrow(InvalidStatusShaError);
  });

  it('refuses the sha of an annotated tag object', async () => {
    await expect(
      statuses.create({ ...owner, sha: tagSha, body: { state: 'success' } }),
    ).rejects.toThrow(InvalidStatusShaError);
  });

  it('refuses a reader without write access', async () => {
    await expect(
      statuses.create({ ...reader, sha, body: { state: 'success' } }),
    ).rejects.toThrow(RepositoryForbiddenError);
  });

  it('refuses a context past its cap', async () => {
    await db.insert(schema.commitStatus).values(
      Array.from({ length: 1000 }, () => ({
        repositoryId: repository.id,
        sha,
        state: 'pending' as const,
        context: 'ci',
      })),
    );

    await expect(
      statuses.create({
        ...owner,
        sha,
        body: { state: 'success', context: 'ci' },
      }),
    ).rejects.toThrow(TooManyStatusesError);
  });

  it('merges statuses across repositories, the first repository winning a shared context', async () => {
    const [fork] = await db
      .insert(schema.repository)
      .values({ name: 'app-fork', slug: 'app-fork', ownerId: READER })
      .returning();
    await db.insert(schema.commitStatus).values([
      {
        repositoryId: repository.id,
        sha,
        state: 'failure',
        context: 'ci',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        repositoryId: fork.id,
        sha,
        state: 'success',
        context: 'ci',
        createdAt: new Date('2026-01-02T00:00:00Z'),
      },
      {
        repositoryId: fork.id,
        sha,
        state: 'pending',
        context: 'lint',
        createdAt: new Date('2026-01-02T00:00:00Z'),
      },
    ]);

    const combined = await statuses.combinedFor(
      [repository.id, fork.id],
      [sha],
    );
    expect(combined.get(sha)).toMatchObject({
      sha,
      state: 'failure',
      totalCount: 2,
      statuses: [
        { state: 'failure', context: 'ci', creator: null },
        { state: 'pending', context: 'lint', creator: null },
      ],
    });
  });
});
