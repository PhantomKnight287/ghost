import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ZERO_OID } from '../wal/wal.types.js';
import { addedCommits, peeledCommit } from './added-commits.js';

describe('addedCommits', () => {
  let root: string;
  let gitDir: string;
  let counter = 0;

  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'Author@Example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'committer@example.com',
      },
    }).trim();
  const commit = () => {
    writeFileSync(path.join(root, 'file.txt'), `${++counter}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', `commit ${counter}`);
    return git('rev-parse', 'HEAD');
  };
  const transition = (ref: string, oldOid: string | null, newOid: string) => ({
    ref,
    oldOid: oldOid ? Buffer.from(oldOid, 'hex') : ZERO_OID,
    newOid: Buffer.from(newOid, 'hex'),
  });

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-added-'));
    execFileSync('git', ['init', '-q', '-b', 'main', root]);
    gitDir = path.join(root, '.git');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('gives exactly the commits an update adds, newest first, with author addresses', async () => {
    const base = commit();
    const second = commit();
    const third = commit();

    expect(
      await addedCommits({
        gitDir,
        transition: transition('refs/heads/main', base, third),
      }),
    ).toEqual([
      { sha: third, authorEmail: 'Author@Example.com' },
      { sha: second, authorEmail: 'Author@Example.com' },
    ]);
  });

  it('gives a new ref only the commits no other ref reaches', async () => {
    const shared = commit();
    git('checkout', '-q', '-b', 'feature');
    const own = commit();
    git('checkout', '-q', 'main');
    git('update-ref', '-d', 'refs/heads/feature');

    expect(
      (
        await addedCommits({
          gitDir,
          transition: transition('refs/heads/feature', null, own),
        })
      ).map(({ sha }) => sha),
    ).toEqual([own]);
    expect(shared).not.toBe(own);
  });

  it('ignores commits only refs/pull/* reaches when judging a create', async () => {
    commit();
    const pulled = commit();
    git('update-ref', 'refs/pull/1/head', pulled);
    git('reset', '-q', '--hard', 'HEAD~1');

    expect(
      (
        await addedCommits({
          gitDir,
          transition: transition('refs/heads/copy', null, pulled),
        })
      ).map(({ sha }) => sha),
    ).toEqual([pulled]);
  });

  it('gives nothing for a create at history the repository already holds', async () => {
    const tip = commit();
    expect(
      await addedCommits({
        gitDir,
        transition: transition('refs/heads/again', null, tip),
      }),
    ).toEqual([]);
  });

  it('peels an annotated tag to its commit', async () => {
    const tip = commit();
    git('tag', '-a', 'v1', '-m', 'release');
    const tag = git('rev-parse', 'refs/tags/v1');

    expect(tag).not.toBe(tip);
    expect(await peeledCommit({ gitDir, oid: tag })).toBe(tip);
    expect(await peeledCommit({ gitDir, oid: tip })).toBe(tip);
  });
});
