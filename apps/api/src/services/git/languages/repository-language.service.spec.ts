import { Test, type TestingModule } from '@nestjs/testing';
import { createDatabase, schema, type Database, type Pool } from '@ghost/db';
import { eq } from 'drizzle-orm';
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
import { RepositoryLanguageService } from './repository-language.service.js';

const CONNECTION = process.env.TEST_DATABASE_URL;
const REF = 'refs/heads/main';
const MIGRATIONS = path.resolve(
  import.meta.dirname,
  '../../../../../../packages/db/drizzle',
);

// Needs a throwaway Postgres; the suite is skipped without one.
describe.skipIf(!CONNECTION)('RepositoryLanguageService', () => {
  let db: Database;
  let pool: Pool;
  let service: RepositoryLanguageService;
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

  const languages = () =>
    service.getLanguages({ repositoryId, repoDirectory: gitDir, ref: REF });

  const bytesOf = async (language: string) =>
    (await languages()).find((row) => row.language === language)?.bytes;

  beforeAll(async () => {
    ({ db, pool } = createDatabase({ connectionString: CONNECTION }));
    await migrate(db, { migrationsFolder: MIGRATIONS });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RepositoryLanguageService,
        { provide: DATABASE, useValue: db },
      ],
    }).compile();
    service = module.get(RepositoryLanguageService);

    await db
      .insert(schema.user)
      .values({
        id: 'user_language_spec',
        name: 'Test',
        email: 'languages@example.com',
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db
      .delete(schema.user)
      .where(eq(schema.user.id, 'user_language_spec'));
    await pool.end();
  });

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-languages-'));
    gitDir = path.join(root, '.git');
    execFileSync('git', ['init', '-q', '-b', 'main', root]);
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');

    const [repository] = await db
      .insert(schema.repository)
      .values({
        name: 'spec',
        slug: `spec-${Date.now()}`,
        ownerId: 'user_language_spec',
      })
      .returning();
    repositoryId = repository.id;
  });

  afterEach(async () => {
    rmSync(root, { recursive: true, force: true });
    // cascades to both language tables
    await db
      .delete(schema.repository)
      .where(eq(schema.repository.id, repositoryId));
  });

  it('returns nothing when the ref does not exist', async () => {
    expect(await languages()).toEqual([]);
  });

  it('counts bytes per language, largest first, ignoring unknown files', async () => {
    commit('src/a.ts', 'x'.repeat(30), 'add a');
    commit('src/b.py', 'y'.repeat(10), 'add b');
    commit('LICENSE', 'z'.repeat(500), 'add a file with no language');

    expect(await languages()).toEqual([
      { language: 'TypeScript', bytes: 30 },
      { language: 'Python', bytes: 10 },
    ]);
  });

  it('applies a fast-forward as a delta', async () => {
    commit('src/a.ts', 'x'.repeat(30), 'add a');
    await languages();

    commit('src/a.ts', 'x'.repeat(50), 'grow a');
    commit('src/c.go', 'g'.repeat(7), 'add c');

    expect(await languages()).toEqual([
      { language: 'TypeScript', bytes: 50 },
      { language: 'Go', bytes: 7 },
    ]);
  });

  it('drops a language once its last file is deleted', async () => {
    commit('src/a.ts', 'x'.repeat(30), 'add a');
    commit('src/b.py', 'y'.repeat(10), 'add b');
    await languages();

    git('rm', '-q', 'src/b.py');
    git('commit', '-m', 'remove b');

    expect(await bytesOf('Python')).toBeUndefined();
    expect(await bytesOf('TypeScript')).toBe(30);
  });

  it('recounts from the tree after a force push', async () => {
    const first = commit('src/a.ts', 'x'.repeat(30), 'add a');
    commit('src/gone.py', 'y'.repeat(10), 'add a file to discard');
    await languages();
    expect(await bytesOf('Python')).toBe(10);

    git('reset', '-q', '--hard', first);
    commit('src/kept.go', 'g'.repeat(4), 'rewritten history');

    expect(await languages()).toEqual([
      { language: 'TypeScript', bytes: 30 },
      { language: 'Go', bytes: 4 },
    ]);
  });

  it('leaves the stored rows alone when the ref has not moved', async () => {
    commit('src/a.ts', 'x'.repeat(30), 'add a');
    await languages();

    const before = await db
      .select()
      .from(schema.repositoryLanguageIndex)
      .where(eq(schema.repositoryLanguageIndex.repositoryId, repositoryId));
    await languages();
    const after = await db
      .select()
      .from(schema.repositoryLanguageIndex)
      .where(eq(schema.repositoryLanguageIndex.repositoryId, repositoryId));

    expect(after).toEqual(before);
  });

  it('skips symlinks', async () => {
    commit('src/a.ts', 'x'.repeat(30), 'add a');
    execFileSync('ln', ['-s', 'a.ts', path.join(root, 'src/link.ts')]);
    git('add', 'src/link.ts');
    git('commit', '-m', 'add a symlink');

    expect(await bytesOf('TypeScript')).toBe(30);
  });
});
