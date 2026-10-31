import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryWalStore } from '../../../lib/git/materializer/wal-store.fake.js';
import { bufferBody } from '../../../lib/git/protocol/git-request-body.js';
import { createUlid } from '../../../lib/git/wal/ulid.js';
import { encodeEntryHeader } from '../../../lib/git/wal/wal-codec.js';
import { RepositoryDeletedError } from '../../../lib/git/wal/wal.errors.js';
import {
  applyTransitions,
  emptyIndex,
  type RefTransition,
  ZERO_OID,
} from '../../../lib/git/wal/wal.types.js';
import { RepositoryMaterializerService } from '../materializer/repository-materializer.service.js';
import type { RepositoryStorageService } from '../repository-storage/repository-storage.service.js';
import { PushTransactionService } from '../wal/push-transaction.service.js';
import type { WalStoreService } from '../wal/wal-store.service.js';
import { RepositoryRepairService } from './repository-repair.service.js';

const REPO = 'repo_repair';
const identity = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};
const garbage = Buffer.concat([
  Buffer.from('PACK'),
  Buffer.from([0, 0, 0, 2, 0, 0, 0, 1]),
]);

describe('RepositoryRepairService', () => {
  let root: string;
  let work: string;
  let cache: string;
  let store: InMemoryWalStore;
  let repair: RepositoryRepairService;
  let first: string;

  const git = (cwd: string, args: string[], input?: string) => {
    const env: NodeJS.ProcessEnv = { ...process.env, ...identity };
    delete env.GIT_DIR;
    return execFileSync('git', args, { cwd, env, input, maxBuffer: 1 << 26 });
  };
  const text = (cwd: string, ...args: string[]) =>
    git(cwd, args).toString('utf8').trim();
  const set = (ref: string, sha: string, old = ZERO_OID): RefTransition => ({
    ref,
    oldOid: old,
    newOid: Buffer.from(sha, 'hex'),
  });
  const pack = (revs: string) =>
    git(work, ['pack-objects', '--stdout', '--revs', '--thin'], `${revs}\n`);
  const storage = (directory: string) =>
    ({
      getRepoPath: async () => directory,
    }) as unknown as RepositoryStorageService;

  /** Writes an entry the way the log did before 0034, with no check of any kind: the only way a broken log comes to exist. */
  async function append(transitions: RefTransition[], bytes: Buffer) {
    const stored = await store.readIndex(REPO);
    const index = stored?.index ?? emptyIndex();
    const ulid = createUlid();
    await store.putEntry(
      REPO,
      ulid,
      encodeEntryHeader({
        ulid,
        createdAt: Date.now(),
        pushedBy: null,
        transitions,
      }),
      bufferBody(bytes),
      0,
    );
    await store.casIndex(
      REPO,
      {
        ...index,
        seq: index.seq + 1,
        refs: applyTransitions(index.refs, transitions),
        layers: [
          ...index.layers,
          {
            ulid,
            packSha: createHash('sha256').update(bytes).digest(),
            size: bytes.length,
          },
        ],
      },
      stored?.etag ?? null,
    );
  }

  /** What a node holding nothing but the log ends up with: its refs, or the error that stops it. */
  async function replayFresh() {
    const fresh = mkdtempSync(path.join(root, 'fresh-'));
    execFileSync('git', ['init', '-q', '--bare', fresh]);
    await new RepositoryMaterializerService(
      store as unknown as WalStoreService,
      storage(fresh),
    ).materialize(REPO, fresh, null);
    return Object.fromEntries(
      text(fresh, 'for-each-ref', '--format=%(refname) %(objectname)')
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split(' ')),
    ) as Record<string, string>;
  }

  /** The local cache as the API keeps it, up to date with the log as it stood before the damage. */
  async function warmCache() {
    await new RepositoryMaterializerService(
      store as unknown as WalStoreService,
      storage(cache),
    ).materialize(REPO, cache, null);
  }

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-repair-'));
    work = path.join(root, 'work');
    cache = path.join(root, 'cache.git');
    execFileSync('git', ['init', '-q', '-b', 'main', work]);
    execFileSync('git', ['init', '-q', '--bare', cache]);
    writeFileSync(path.join(work, 'a.txt'), 'first\n');
    git(work, ['add', '-A']);
    git(work, ['commit', '-q', '-m', 'first']);
    first = text(work, 'rev-parse', 'HEAD');

    store = new InMemoryWalStore();
    repair = new RepositoryRepairService(
      store as unknown as WalStoreService,
      new PushTransactionService(store as unknown as WalStoreService),
      storage(cache),
    );
    await append([set('refs/heads/main', first)], pack(first));
    await warmCache();
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('leaves a log that replays alone untouched', async () => {
    const before = await store.readIndex(REPO);

    expect(await repair.check(REPO)).toBeNull();
    expect(await repair.repair(REPO)).toBeNull();
    expect((await store.readIndex(REPO))!.etag).toBe(before!.etag);
  });

  it('has nothing to say about a repository with no log', async () => {
    expect(await repair.check('repo_never_pushed')).toBeNull();
    expect(await repair.repair('repo_never_pushed')).toBeNull();
  });

  it.each(['check', 'repair'] as const)(
    '%s treats a deleted repository as absent',
    async (operation) => {
      vi.spyOn(store, 'readIndex').mockRejectedValue(
        new RepositoryDeletedError(),
      );
      const openPack = vi.spyOn(store, 'openEntryPack');
      const writeIndex = vi.spyOn(store, 'casIndex');

      await expect(repair[operation](REPO)).resolves.toBeNull();
      expect(openPack).not.toHaveBeenCalled();
      expect(writeIndex).not.toHaveBeenCalled();
    },
  );

  it.each(['check', 'repair'] as const)(
    '%s propagates other index read errors',
    async (operation) => {
      const error = new Error('object storage is unavailable');
      vi.spyOn(store, 'readIndex').mockRejectedValue(error);

      await expect(repair[operation](REPO)).rejects.toBe(error);
    },
  );

  it('only reports when checking, and writes nothing', async () => {
    await append([set('refs/heads/evil', 'ab'.repeat(20))], Buffer.alloc(0));
    const before = await store.readIndex(REPO);

    expect(await repair.check(REPO)).toEqual({
      layers: [],
      rescued: [],
      dropped: [
        {
          ref: 'refs/heads/evil',
          oid: 'ab'.repeat(20),
          reason: 'objects it reaches are in neither the log nor the cache',
        },
      ],
    });
    expect((await store.readIndex(REPO))!.etag).toBe(before!.etag);
    await expect(replayFresh()).rejects.toThrow();
  });

  it('drops a ref at an object nobody holds, and the log replays again', async () => {
    await append([set('refs/heads/evil', 'ab'.repeat(20))], Buffer.alloc(0));

    const report = await repair.repair(REPO);

    expect(report?.dropped.map(({ ref }) => ref)).toEqual(['refs/heads/evil']);
    expect(await replayFresh()).toEqual({ 'refs/heads/main': first });
    expect(await repair.check(REPO)).toBeNull();
  });

  it('skips an entry git cannot read, keeping the refs it can still serve', async () => {
    await append([set('refs/heads/copy', first)], garbage);

    const report = await repair.repair(REPO);

    expect(report?.layers).toEqual([
      expect.objectContaining({ outcome: 'dropped' }),
    ]);
    expect(report?.dropped).toEqual([]);
    expect(await replayFresh()).toEqual({
      'refs/heads/main': first,
      'refs/heads/copy': first,
    });
  });

  it('skips an entry object storage lost', async () => {
    const stored = await store.readIndex(REPO);
    await store.casIndex(
      REPO,
      {
        ...stored!.index,
        seq: stored!.index.seq + 1,
        layers: [
          ...stored!.index.layers,
          { ulid: createUlid(), packSha: Buffer.alloc(32), size: 10 },
        ],
      },
      stored!.etag,
    );

    const report = await repair.repair(REPO);

    expect(report?.layers).toEqual([
      {
        ulid: expect.any(String),
        outcome: 'dropped',
        reason: 'the entry is missing from object storage',
      },
    ]);
    expect(await replayFresh()).toEqual({ 'refs/heads/main': first });
  });

  it('rebuilds an entry thin against objects only the cache held, and puts back the history it reached', async () => {
    // Random lines, so the next version can only travel as a delta against this one.
    const lines = Array.from(
      { length: 3000 },
      (_, i) => `${i}:${Math.random()}`,
    );
    writeFileSync(path.join(work, 'content.txt'), `${lines.join('\n')}\n`);
    git(work, ['add', '-A']);
    git(work, ['commit', '-q', '-m', 'only the cache ever got this']);
    const cached = text(work, 'rev-parse', 'HEAD');
    execFileSync('git', ['index-pack', '--stdin'], {
      env: { ...process.env, GIT_DIR: cache },
      input: pack(`${cached}\n^${first}`),
    });
    writeFileSync(
      path.join(work, 'content.txt'),
      `${lines.join('\n')}\none more\n`,
    );
    git(work, ['commit', '-q', '-am', 'one more line']);
    const tip = text(work, 'rev-parse', 'HEAD');
    await append(
      [set('refs/heads/main', tip, Buffer.from(first, 'hex'))],
      pack(`${tip}\n^${cached}`),
    );
    await expect(replayFresh()).rejects.toThrow();

    const report = await repair.repair(REPO);

    expect(report?.layers).toEqual([
      expect.objectContaining({ outcome: 'rebuilt' }),
    ]);
    expect(report?.rescued).toEqual(['refs/heads/main']);
    expect(report?.dropped).toEqual([]);
    expect(await replayFresh()).toEqual({ 'refs/heads/main': tip });
  });

  it('drops a branch at anything but a commit', async () => {
    const tree = text(work, 'rev-parse', `${first}^{tree}`);
    await append([set('refs/heads/tree', tree)], Buffer.alloc(0));

    const report = await repair.repair(REPO);

    expect(report?.dropped).toEqual([
      {
        ref: 'refs/heads/tree',
        oid: tree,
        reason: 'a branch must point at a commit, not a tree',
      },
    ]);
    expect(await replayFresh()).toEqual({ 'refs/heads/main': first });
  });

  it('drops a ref git refuses by name', async () => {
    await append([set('refs/heads/a..b', first)], Buffer.alloc(0));

    const report = await repair.repair(REPO);

    expect(report?.dropped.map(({ ref }) => ref)).toEqual(['refs/heads/a..b']);
    expect(await replayFresh()).toEqual({ 'refs/heads/main': first });
  });

  it('of two refs that cannot coexist, drops the one written later', async () => {
    await append([set('refs/heads/main/nested', first)], Buffer.alloc(0));

    const report = await repair.repair(REPO);

    expect(report?.dropped).toEqual([
      {
        ref: 'refs/heads/main/nested',
        oid: first,
        reason: 'it conflicts with refs/heads/main',
      },
    ]);
    expect(await replayFresh()).toEqual({ 'refs/heads/main': first });
  });

  it('starts over when a push moves the index during the repair', async () => {
    await append([set('refs/heads/copy', first)], garbage);
    const swap = vi.spyOn(store, 'casIndex').mockResolvedValueOnce(false);

    const report = await repair.repair(REPO);

    expect(swap).toHaveBeenCalledTimes(2);
    expect(report?.layers).toHaveLength(1);
    expect(await replayFresh()).toEqual({
      'refs/heads/main': first,
      'refs/heads/copy': first,
    });
  });
});
