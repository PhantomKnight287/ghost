import { Test, type TestingModule } from '@nestjs/testing';
import { createDatabase, schema, type Database, type Pool } from '@ghost/db';
import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { DATABASE } from '../../../database/database.module.js';
import { RepositoryPathIndexService } from './repository-path-index.service.js';

const CONNECTION = process.env.TEST_DATABASE_URL;
const REF = 'refs/heads/main';
const MIGRATIONS = path.resolve(
  import.meta.dirname,
  '../../../../../../packages/db/drizzle',
);

// Needs a throwaway Postgres; the suite is skipped without one.
describe.skipIf(!CONNECTION)('RepositoryPathIndexService', () => {
  let db: Database;
  let pool: Pool;
  let service: RepositoryPathIndexService;
  let root: string;
  let gitDir: string;
  let repositoryId: string;

  function git(...args: string[]) {
    const env = { ...process.env };
    delete env.GIT_DIR;
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env,
    }).trim();
  }

  function commit(file: string, contents: string, message: string) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), contents);
    git('add', file);
    git('commit', '-m', message);
    return git('rev-parse', 'HEAD');
  }

  const sync = () =>
    service.sync({ repositoryId, repoDirectory: gitDir, ref: REF });

  async function rowsByPath() {
    const rows = await db
      .select()
      .from(schema.repositoryPathCommit)
      .where(eq(schema.repositoryPathCommit.repositoryId, repositoryId));
    return new Map(rows.map((row) => [row.path, row]));
  }

  beforeAll(async () => {
    ({ db, pool } = createDatabase({ connectionString: CONNECTION }));
    await migrate(db, { migrationsFolder: MIGRATIONS });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RepositoryPathIndexService,
        { provide: DATABASE, useValue: db },
      ],
    }).compile();
    service = module.get(RepositoryPathIndexService);

    await db
      .insert(schema.user)
      .values({
        id: 'user_path_index_spec',
        name: 'Test',
        email: 'path-index@example.com',
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db
      .delete(schema.user)
      .where(eq(schema.user.id, 'user_path_index_spec'));
    await pool.end();
  });

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-index-'));
    gitDir = path.join(root, '.git');
    execFileSync('git', ['init', '-q', '-b', 'main', root]);
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');

    const [repository] = await db
      .insert(schema.repository)
      .values({
        name: 'spec',
        slug: `spec-${Date.now()}`,
        ownerId: 'user_path_index_spec',
      })
      .returning();
    repositoryId = repository.id;
  });

  afterEach(async () => {
    rmSync(root, { recursive: true, force: true });
    // cascades to both index tables
    await db
      .delete(schema.repository)
      .where(eq(schema.repository.id, repositoryId));
  });

  it('returns null and writes nothing when the ref does not exist', async () => {
    expect(await sync()).toBeNull();
    expect(await rowsByPath()).toEqual(new Map());
  });

  it('records the newest commit for every path and its ancestors', async () => {
    commit('README.md', 'a', 'first commit');
    const addX = commit('src/deep/x.ts', 'b', 'add x');

    expect(await sync()).toBe(addX);

    const rows = await rowsByPath();
    expect(rows.get('src/deep/x.ts')).toMatchObject({
      commitSha: addX,
      subject: 'add x',
    });
    // ancestors inherit the newest commit beneath them
    expect(rows.get('src/deep')?.commitSha).toBe(addX);
    expect(rows.get('src')?.commitSha).toBe(addX);
    expect(rows.get('')?.commitSha).toBe(addX);
    expect(rows.get('README.md')?.subject).toBe('first commit');
  });

  it('stores the committer timestamp', async () => {
    commit('README.md', 'a', 'first commit');
    await sync();

    const seconds = Number(git('log', '-1', '--format=%ct'));
    expect((await rowsByPath()).get('README.md')?.committedAt).toEqual(
      new Date(seconds * 1000),
    );
  });

  it('tops up incrementally and leaves untouched paths alone', async () => {
    const first = commit('README.md', 'a', 'first commit');
    await sync();

    const second = commit('src/y.ts', 'b', 'add y');
    expect(await sync()).toBe(second);

    const rows = await rowsByPath();
    expect(rows.get('README.md')?.commitSha).toBe(first);
    expect(rows.get('src/y.ts')?.commitSha).toBe(second);
    // the root row follows the tip
    expect(rows.get('')?.commitSha).toBe(second);
  });

  it('is a no-op when the ref has not moved', async () => {
    commit('README.md', 'a', 'first commit');
    await sync();
    const before = await db
      .select()
      .from(schema.repositoryRefIndex)
      .where(eq(schema.repositoryRefIndex.repositoryId, repositoryId));

    await sync();
    const after = await db
      .select()
      .from(schema.repositoryRefIndex)
      .where(eq(schema.repositoryRefIndex.repositoryId, repositoryId));

    expect(after).toEqual(before);
  });

  it('rebuilds from scratch after a force push drops commits', async () => {
    const first = commit('README.md', 'a', 'first commit');
    commit('gone.txt', 'b', 'add a file that will be discarded');
    await sync();
    expect((await rowsByPath()).has('gone.txt')).toBe(true);

    git('reset', '-q', '--hard', first);
    const replacement = commit('kept.txt', 'c', 'rewritten history');

    expect(await sync()).toBe(replacement);

    const rows = await rowsByPath();
    // a rebuild clears the ref's rows, so the discarded path is gone
    expect(rows.has('gone.txt')).toBe(false);
    expect(rows.get('kept.txt')?.commitSha).toBe(replacement);
  });

  it('attributes a merged file to the commit that wrote it', async () => {
    commit('README.md', 'a', 'first commit');
    git('checkout', '-q', '-b', 'feat');
    const onBranch = commit('src/z.ts', 'c', 'add z on branch');
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', 'feat', '-m', 'merge feat');

    await sync();

    expect((await rowsByPath()).get('src/z.ts')).toMatchObject({
      commitSha: onBranch,
      subject: 'add z on branch',
    });
  });

  it('looks up only the requested paths', async () => {
    commit('README.md', 'a', 'first commit');
    const addY = commit('src/y.ts', 'b', 'add y');
    await sync();

    const found = await service.lookup({
      repositoryId,
      ref: REF,
      paths: ['src/y.ts', 'does/not/exist'],
    });

    expect([...found.keys()]).toEqual(['src/y.ts']);
    expect(found.get('src/y.ts')?.commitSha).toBe(addY);
  });

  it('keeps a second ref independent', async () => {
    commit('README.md', 'a', 'first commit');
    await sync();

    const rows = await db
      .select()
      .from(schema.repositoryPathCommit)
      .where(
        and(
          eq(schema.repositoryPathCommit.repositoryId, repositoryId),
          eq(schema.repositoryPathCommit.ref, 'refs/heads/other'),
        ),
      );
    expect(rows).toEqual([]);
  });
});
