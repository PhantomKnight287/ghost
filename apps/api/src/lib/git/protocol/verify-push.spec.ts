import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buffer } from 'node:stream/consumers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type RefTransition, ZERO_OID } from '../wal/wal.types.js';
import { bufferBody, type GitRequestBody } from './git-request-body.js';
import { PushRejectedError } from './protocol.errors.js';
import { withVerifiedPack } from './verify-push.js';

const identity = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

describe('withVerifiedPack', () => {
  let root: string;
  let cache: string;
  let work: string;
  let first: string;

  const git = (cwd: string, args: string[], input?: Buffer | string) => {
    const env: NodeJS.ProcessEnv = { ...process.env, ...identity };
    delete env.GIT_DIR;
    return execFileSync('git', args, { cwd, env, input, maxBuffer: 1 << 26 });
  };
  const text = (cwd: string, ...args: string[]) =>
    git(cwd, args).toString('utf8').trim();
  const update = (ref: string, sha: string, old = ZERO_OID): RefTransition => ({
    ref,
    oldOid: old,
    newOid: Buffer.from(sha, 'hex'),
  });
  const deletion = (ref: string, sha: string): RefTransition => ({
    ref,
    oldOid: Buffer.from(sha, 'hex'),
    newOid: ZERO_OID,
  });
  /** What a client sends: the objects `tip` adds over `excluded`, thin against them. */
  const thinPack = (tip: string, ...excluded: string[]) =>
    git(
      work,
      ['pack-objects', '--stdout', '--revs', '--thin'],
      `${tip}\n${excluded.map((sha) => `^${sha}`).join('\n')}\n`,
    );
  const verified = async (transitions: RefTransition[], pack: Buffer) => {
    let stored = Buffer.alloc(0);
    await withVerifiedPack(
      { gitDir: cache, transitions, body: bufferBody(pack), packOffset: 0 },
      async ({
        body,
        packOffset,
      }: {
        body: GitRequestBody;
        packOffset: number;
      }) => {
        stored = await buffer(body.open(packOffset));
      },
    );
    return stored;
  };
  /** A repository with no objects at all, given only `pack`: indexing fails if the pack leans on a delta base it does not carry. */
  const indexesAlone = (pack: Buffer) => {
    const node = mkdtempSync(path.join(root, 'node-'));
    execFileSync('git', ['init', '-q', '--bare', node]);
    git(node, ['index-pack', '--stdin'], pack);
    return node;
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-verify-'));
    cache = path.join(root, 'cache.git');
    work = path.join(root, 'work');
    execFileSync('git', ['init', '-q', '-b', 'main', work]);
    writeFileSync(path.join(work, 'a.txt'), 'first\n');
    git(work, ['add', '-A']);
    git(work, ['commit', '-q', '-m', 'first']);
    first = text(work, 'rev-parse', 'HEAD');
    execFileSync('git', ['clone', '-q', '--bare', work, cache]);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('stores a pack that replays without borrowing a delta base from anywhere', async () => {
    // Random lines, so the new version is only small as a delta against the old.
    const lines = Array.from(
      { length: 3000 },
      (_, i) => `${i}:${Math.random()}`,
    );
    writeFileSync(path.join(work, 'content.txt'), `${lines.join('\n')}\n`);
    git(work, ['add', '-A']);
    git(work, ['commit', '-q', '-m', 'large']);
    const large = text(work, 'rev-parse', 'HEAD');
    git(work, ['push', '-q', cache, 'main']);
    writeFileSync(
      path.join(work, 'content.txt'),
      `${lines.join('\n')}\none more\n`,
    );
    git(work, ['commit', '-q', '-am', 'one more line']);
    const tip = text(work, 'rev-parse', 'HEAD');
    const pushed = thinPack(tip, large);
    expect(() => indexesAlone(pushed)).toThrow();

    const stored = await verified(
      [update('refs/heads/main', tip, Buffer.from(large, 'hex'))],
      pushed,
    );

    expect(text(indexesAlone(stored), 'cat-file', '-t', tip)).toBe('commit');
  });

  it('refuses a ref at an object only the cache holds, with or without a pack', async () => {
    // Left behind the way a merge that never landed leaves its commit.
    const orphan = text(
      cache,
      'commit-tree',
      `${first}^{tree}`,
      '-p',
      first,
      '-m',
      'never in the log',
    );
    writeFileSync(path.join(work, 'b.txt'), 'b\n');
    git(work, ['add', '-A']);
    git(work, ['commit', '-q', '-m', 'b']);
    const b = text(work, 'rev-parse', 'HEAD');

    await expect(
      verified([update('refs/heads/stray', orphan)], Buffer.alloc(0)),
    ).rejects.toThrow(`${orphan} is reachable from the pushed refs`);
    await expect(
      verified(
        [
          update('refs/heads/main', b, Buffer.from(first, 'hex')),
          update('refs/heads/stray', orphan),
        ],
        thinPack(b, first),
      ),
    ).rejects.toThrow(`${orphan} is reachable from the pushed refs`);
  });

  it('refuses a ref at an object nobody holds', async () => {
    await expect(
      verified([update('refs/heads/evil', 'ab'.repeat(20))], Buffer.alloc(0)),
    ).rejects.toThrow('which neither the push nor the repository holds');
  });

  it('refuses a branch at anything but a commit', async () => {
    const tree = text(cache, 'rev-parse', `${first}^{tree}`);
    await expect(
      verified([update('refs/heads/tree', tree)], Buffer.alloc(0)),
    ).rejects.toThrow('must point at a commit, not a tree');
  });

  it('refuses a pack git cannot read, even one that updates nothing', async () => {
    const garbage = Buffer.concat([
      Buffer.from('PACK'),
      Buffer.from([0, 0, 0, 2, 0, 0, 0, 0]),
    ]);
    for (const transitions of [
      [update('refs/heads/copy', first)],
      [deletion('refs/heads/main', first)],
    ]) {
      await expect(verified(transitions, garbage)).rejects.toBeInstanceOf(
        PushRejectedError,
      );
    }
  });

  it('hands a delete with no pack straight through', async () => {
    expect(
      await verified([deletion('refs/heads/main', first)], Buffer.alloc(0)),
    ).toEqual(Buffer.alloc(0));
  });

  it('verifies a push of more refs than argv can carry', async () => {
    writeFileSync(path.join(work, 'a.txt'), 'second\n');
    git(work, ['commit', '-q', '-am', 'second']);
    const second = text(work, 'rev-parse', 'HEAD');
    // ~1.2 MB of object names, past macOS's 1 MB ARG_MAX, as an import's pull request refs are
    const refs = Array.from({ length: 30_000 }, (_, number) =>
      update(`refs/pull/${number}/head`, second),
    );
    expect(
      (await verified(refs, thinPack(second, first))).length,
    ).toBeGreaterThan(0);
  });

  it('accepts a new branch at a commit the repository already reaches', async () => {
    expect(
      await verified([update('refs/heads/copy', first)], Buffer.alloc(0)),
    ).toEqual(Buffer.alloc(0));
  });
});
