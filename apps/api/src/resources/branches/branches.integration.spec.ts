import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDatabase, type Database, type Pool, schema } from '@ghost/db';
import { eq, inArray } from 'drizzle-orm';
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

import { InMemoryWalStore } from '../../lib/git/materializer/wal-store.fake.js';
import { bufferBody } from '../../lib/git/protocol/git-request-body.js';
import { RepositoryForbiddenError } from '../../lib/git/repository-access/repository-access.errors.js';
import { ZERO_OID } from '../../lib/git/wal/wal.types.js';
import { BranchesService } from '../../services/git/branches/branches.service.js';
import { RepositoryMaterializerService } from '../../services/git/materializer/repository-materializer.service.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import type { RepositoryStorageService } from '../../services/git/repository-storage/repository-storage.service.js';
import { PushTransactionService } from '../../services/git/wal/push-transaction.service.js';
import type { WalStoreService } from '../../services/git/wal/wal-store.service.js';
import { BranchNotFoundError } from '../repositories/repositories.errors.js';
import {
  BranchAlreadyExistsError,
  BranchInUseError,
  BranchSourceNotFoundError,
  DefaultBranchDeletionError,
  InvalidBranchNameError,
} from './branches.errors.js';
import { RepositoryBranchesService } from './repository-branches.service.js';

const CONNECTION = process.env.TEST_DATABASE_URL;
const MIGRATIONS = path.resolve(
  import.meta.dirname,
  '../../../../../packages/db/drizzle',
);

const OWNER = 'user_branch_owner';
const READER = 'user_branch_reader';

function git(cwd: string, ...args: string[]) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  return execFileSync('git', args, { cwd, encoding: 'utf8', env }).trim();
}

// Needs a throwaway Postgres; the suite is skipped without one.
describe.skipIf(!CONNECTION)('branches', () => {
  let db: Database;
  let pool: Pool;
  let root: string;
  let source: string;
  let cache: string;
  let service: RepositoryBranchesService;
  let branches: BranchesService;
  let materializer: RepositoryMaterializerService;
  let pushes: PushTransactionService;
  let repository: typeof schema.repository.$inferSelect;
  let first: string;
  let second: string;

  const owner = { username: 'branch-owner', repo: 'app', requesterId: OWNER };
  const reader = { ...owner, requesterId: READER };

  async function commitAndLog(message: string, before: string) {
    writeFileSync(path.join(source, 'README.md'), `${message}\n`);
    git(source, 'add', '-A');
    git(source, 'commit', '-m', message);
    const after = git(source, 'rev-parse', 'HEAD');

    await pushes.commitPush({
      repoId: repository.id,
      transitions: [
        {
          ref: 'refs/heads/main',
          oldOid: before ? Buffer.from(before, 'hex') : ZERO_OID,
          newOid: Buffer.from(after, 'hex'),
        },
      ],
      body: bufferBody(
        execFileSync('git', ['pack-objects', '--stdout', '--revs', '--thin'], {
          cwd: source,
          input: before ? `HEAD\n^${before}\n` : 'HEAD\n',
        }),
      ),
      packOffset: 0,
    });
    return after;
  }

  /** Branches as a fresh read of the log sees them. */
  async function listed() {
    await materializer.materialize(repository.id, cache, null);
    return branches.getGitBranches(cache);
  }

  beforeAll(async () => {
    ({ db, pool } = createDatabase({ connectionString: CONNECTION }));
    await migrate(db, { migrationsFolder: MIGRATIONS });
  });

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-branches-'));
    source = path.join(root, 'source');
    cache = path.join(root, 'cache.git');
    execFileSync('git', ['init', '-q', '-b', 'main', source]);
    git(source, 'config', 'user.email', 'test@example.com');
    git(source, 'config', 'user.name', 'Test');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', cache]);

    const store = new InMemoryWalStore() as unknown as WalStoreService;
    materializer = new RepositoryMaterializerService(store, {
      getRepoPath: async () => cache,
    } as unknown as RepositoryStorageService);
    pushes = new PushTransactionService(store);
    branches = new BranchesService();
    service = new RepositoryBranchesService(
      db,
      new RepositoryAccessService(db),
      materializer,
      branches,
      pushes,
    );

    await db
      .delete(schema.user)
      .where(inArray(schema.user.id, [OWNER, READER]));
    await db.insert(schema.user).values([
      {
        id: OWNER,
        name: 'Owner',
        email: 'branch-owner@example.com',
        username: 'branch-owner',
      },
      {
        id: READER,
        name: 'Reader',
        email: 'branch-reader@example.com',
        username: 'branch-reader',
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

    first = await commitAndLog('first', '');
    second = await commitAndLog('second', first);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  afterAll(async () => {
    await db
      .delete(schema.user)
      .where(inArray(schema.user.id, [OWNER, READER]));
    await pool?.end();
  });

  it('creates a branch at the default branch, a branch or a sha', async () => {
    await expect(
      service.createBranch({ ...owner, body: { name: 'feat/one' } }),
    ).resolves.toEqual({ name: 'feat/one', sha: second });
    await expect(
      service.createBranch({
        ...owner,
        body: { name: 'two', from: 'feat/one' },
      }),
    ).resolves.toEqual({ name: 'two', sha: second });
    await expect(
      service.createBranch({
        ...owner,
        body: { name: 'old', from: first.slice(0, 8) },
      }),
    ).resolves.toEqual({ name: 'old', sha: first });

    expect(await listed()).toEqual(['feat/one', 'main', 'old', 'two']);
    expect(git(cache, 'rev-parse', 'refs/heads/old')).toBe(first);
  });

  it('refuses a bad name, a taken name, an unknown source and a reader', async () => {
    await expect(
      service.createBranch({ ...owner, body: { name: 'a..b' } }),
    ).rejects.toBeInstanceOf(InvalidBranchNameError);
    await expect(
      service.createBranch({ ...owner, body: { name: 'main' } }),
    ).rejects.toBeInstanceOf(BranchAlreadyExistsError);
    await expect(
      service.createBranch({ ...owner, body: { name: 'x', from: 'nope' } }),
    ).rejects.toBeInstanceOf(BranchSourceNotFoundError);
    await expect(
      service.createBranch({ ...reader, body: { name: 'x' } }),
    ).rejects.toBeInstanceOf(RepositoryForbiddenError);
    expect(await listed()).toEqual(['main']);
  });

  it('refuses to branch an empty repository', async () => {
    await db
      .delete(schema.repository)
      .where(eq(schema.repository.id, repository.id));
    [repository] = await db
      .insert(schema.repository)
      .values({
        name: 'app',
        slug: 'app',
        ownerId: OWNER,
        visibility: 'public',
      })
      .returning();
    rmSync(cache, { recursive: true, force: true });
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', cache]);

    await expect(
      service.createBranch({ ...owner, body: { name: 'x' } }),
    ).rejects.toBeInstanceOf(BranchSourceNotFoundError);
  });

  it('deletes a branch', async () => {
    await service.createBranch({ ...owner, body: { name: 'feat/one' } });
    await service.deleteBranch({ ...owner, branch: 'feat/one' });
    expect(await listed()).toEqual(['main']);
  });

  it('refuses the default branch, a missing branch and a reader', async () => {
    await service.createBranch({ ...owner, body: { name: 'feature' } });

    await expect(
      service.deleteBranch({ ...owner, branch: 'main' }),
    ).rejects.toBeInstanceOf(DefaultBranchDeletionError);
    await expect(
      service.deleteBranch({ ...owner, branch: 'nope' }),
    ).rejects.toBeInstanceOf(BranchNotFoundError);
    await expect(
      service.deleteBranch({ ...reader, branch: 'feature' }),
    ).rejects.toBeInstanceOf(RepositoryForbiddenError);
    expect(await listed()).toEqual(['feature', 'main']);
  });

  it('refuses a branch an open pull request compares, as base or head', async () => {
    await service.createBranch({ ...owner, body: { name: 'base' } });
    await service.createBranch({ ...owner, body: { name: 'topic' } });
    const [issue] = await db
      .insert(schema.issue)
      .values({
        repositoryId: repository.id,
        number: 7,
        title: 'pr',
        isPullRequest: true,
        authorId: OWNER,
      })
      .returning();
    const [pull] = await db
      .insert(schema.pullRequest)
      .values({
        issueId: issue.id,
        baseRepositoryId: repository.id,
        baseRef: 'base',
        headRepositoryId: repository.id,
        headRef: 'topic',
        headSha: second,
      })
      .returning();

    for (const branch of ['base', 'topic']) {
      await expect(
        service.deleteBranch({ ...owner, branch }),
      ).rejects.toBeInstanceOf(BranchInUseError);
    }

    await db
      .update(schema.pullRequest)
      .set({ state: 'closed' })
      .where(eq(schema.pullRequest.id, pull.id));
    await service.deleteBranch({ ...owner, branch: 'topic' });
    expect(await listed()).toEqual(['base', 'main']);
  });
});
