import { Test, TestingModule } from '@nestjs/testing';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PushTransactionService } from '../wal/push-transaction.service.js';
import { WalStoreService } from '../wal/wal-store.service.js';
import { ZERO_OID, type RefTransition } from '../wal/wal.types.js';
import { bufferBody } from '../protocol/git-request-body.js';
import { RepositoryMaterializerService } from './repository-materializer.service.js';
import { InMemoryWalStore } from './wal-store.fake.js';

const REPO_ID = 'phantomknight287/ghost';

function git(cwd: string, ...args: string[]) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  return execFileSync('git', args, { cwd, encoding: 'utf8', env }).trim();
}

describe('RepositoryMaterializerService', () => {
  let root: string;
  let source: string;
  let cache: string;
  let store: InMemoryWalStore;
  let materializer: RepositoryMaterializerService;
  let pushes: PushTransactionService;

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-wal-'));
    source = path.join(root, 'source');
    cache = path.join(root, 'cache.git');

    execFileSync('git', ['init', '-b', 'main', source]);
    git(source, 'config', 'user.email', 'test@example.com');
    git(source, 'config', 'user.name', 'Test');
    execFileSync('git', ['init', '--bare', '-b', 'main', cache]);

    store = new InMemoryWalStore();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RepositoryMaterializerService,
        PushTransactionService,
        { provide: WalStoreService, useValue: store },
      ],
    }).compile();

    materializer = module.get(RepositoryMaterializerService);
    pushes = module.get(PushTransactionService);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /** Commits a file in the source repo and pushes it through the log. */
  async function commitAndLog(file: string, contents: string) {
    const before = headOid();
    writeFileSync(path.join(source, file), contents);
    git(source, 'add', file);
    git(source, 'commit', '-m', `add ${file}`);
    const after = headOid();

    const transition: RefTransition = {
      ref: 'refs/heads/main',
      oldOid: before ? Buffer.from(before, 'hex') : ZERO_OID,
      newOid: Buffer.from(after, 'hex'),
    };

    await pushes.commitPush({
      repoId: REPO_ID,
      transitions: [transition],
      body: bufferBody(packSince(before)),
      packOffset: 0,
    });

    return after;
  }

  function headOid() {
    try {
      return git(source, 'rev-parse', '--verify', '--quiet', 'refs/heads/main');
    } catch {
      return '';
    }
  }

  /** The objects reachable from main but not from `exclude` — a thin pack. */
  function packSince(exclude: string) {
    const revs = exclude
      ? `refs/heads/main\n^${exclude}\n`
      : 'refs/heads/main\n';
    return execFileSync(
      'git',
      ['pack-objects', '--stdout', '--revs', '--thin'],
      {
        cwd: source,
        input: revs,
        maxBuffer: 1 << 28,
      },
    );
  }

  it('leaves a cache untouched when the log is empty', async () => {
    const index = await materializer.materialize(REPO_ID, cache);

    expect(index.seq).toBe(0);
    expect(git(cache, 'for-each-ref', '--format=%(refname)')).toBe('');
  });

  it('reconstructs a repository from the log alone', async () => {
    const oid = await commitAndLog('README.md', '# ghost\n');

    await materializer.materialize(REPO_ID, cache);

    expect(git(cache, 'rev-parse', 'refs/heads/main')).toBe(oid);
    expect(git(cache, 'cat-file', '-p', `${oid}:README.md`)).toBe('# ghost');
  });

  it('points HEAD at a branch that exists so clones are not empty', async () => {
    await commitAndLog('README.md', '# ghost\n');
    await materializer.materialize(REPO_ID, cache);

    expect(git(cache, 'symbolic-ref', 'HEAD')).toBe('refs/heads/main');

    const clone = path.join(root, 'clone');
    execFileSync('git', ['clone', cache, clone]);
    expect(git(clone, 'log', '-1', '--format=%s')).toBe('add README.md');
  });

  it('replays thin packs in sequence order across several pushes', async () => {
    await commitAndLog('a.txt', 'one\n');
    await commitAndLog('b.txt', 'two\n');
    const third = await commitAndLog('c.txt', 'three\n');

    await materializer.materialize(REPO_ID, cache);

    expect(git(cache, 'rev-parse', 'refs/heads/main')).toBe(third);
    expect(git(cache, 'rev-list', '--count', 'refs/heads/main')).toBe('3');
  });

  it('replays only what the cache is missing', async () => {
    await commitAndLog('a.txt', 'one\n');
    await materializer.materialize(REPO_ID, cache);

    const second = await commitAndLog('b.txt', 'two\n');
    const index = await materializer.materialize(REPO_ID, cache);

    expect(index.seq).toBe(2);
    expect(git(cache, 'rev-parse', 'refs/heads/main')).toBe(second);
  });

  it('is a no-op once the cache has caught up', async () => {
    await commitAndLog('a.txt', 'one\n');
    await materializer.materialize(REPO_ID, cache);
    const before = git(cache, 'rev-parse', 'refs/heads/main');

    const index = await materializer.materialize(REPO_ID, cache);

    expect(index.seq).toBe(1);
    expect(git(cache, 'rev-parse', 'refs/heads/main')).toBe(before);
  });

  it('deletes a cached ref the log no longer carries', async () => {
    const oid = await commitAndLog('a.txt', 'one\n');
    await materializer.materialize(REPO_ID, cache);

    git(cache, 'update-ref', 'refs/heads/stale', oid);
    await pushes.commitPush({
      repoId: REPO_ID,
      transitions: [
        {
          ref: 'refs/heads/main',
          oldOid: Buffer.from(oid, 'hex'),
          newOid: Buffer.from(oid, 'hex'),
        },
      ],
      body: bufferBody(Buffer.alloc(0)),
      packOffset: 0,
    });

    await materializer.materialize(REPO_ID, cache);

    expect(git(cache, 'for-each-ref', '--format=%(refname)')).toBe(
      'refs/heads/main',
    );
  });

  it('collapses concurrent materializations of the same repository', async () => {
    await commitAndLog('a.txt', 'one\n');

    const [first, second] = await Promise.all([
      materializer.materialize(REPO_ID, cache),
      materializer.materialize(REPO_ID, cache),
    ]);

    expect(first).toBe(second);
  });
});
