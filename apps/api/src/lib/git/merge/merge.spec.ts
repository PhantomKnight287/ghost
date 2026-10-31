import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as openpgp from 'openpgp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signPayload, verifySignature } from '../../gpg/openpgp.js';
import { readSignedCommits } from '../commits/commit-signature.js';
import {
  commitTree,
  mergeTree,
  packRange,
  rebaseCommits,
  testMergeCommit,
} from './merge.js';

const identity = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

/** A fork's log is copied at fork time and never shares a write again, so the two caches hold disjoint objects. These cover the merge running against that. */
describe('merging across two repositories', () => {
  let root: string;
  let baseDir: string;
  let headDir: string;
  let baseSha: string;
  let headSha: string;

  const git = (cwd: string, ...args: string[]) => {
    const env: NodeJS.ProcessEnv = { ...process.env, ...identity };
    delete env.GIT_DIR;
    return execFileSync('git', args, { cwd, encoding: 'utf8', env }).trim();
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-merge-'));
    const work = path.join(root, 'work');
    baseDir = path.join(root, 'base.git');
    headDir = path.join(root, 'head.git');

    execFileSync('git', ['init', '-q', '-b', 'main', work]);
    git(work, 'config', 'user.email', 'test@example.com');
    git(work, 'config', 'user.name', 'Test');
    writeFileSync(path.join(work, 'shared.txt'), 'shared\n');
    git(work, 'add', '-A');
    git(work, 'commit', '-m', 'shared');
    execFileSync('git', ['clone', '-q', '--bare', work, baseDir]);

    // the fork: a byte copy of the log, exactly what copyLog produces
    cpSync(baseDir, headDir, { recursive: true });

    const fork = path.join(root, 'fork');
    execFileSync('git', ['clone', '-q', headDir, fork]);
    git(fork, 'config', 'user.email', 'test@example.com');
    git(fork, 'config', 'user.name', 'Test');
    git(fork, 'checkout', '-qb', 'feature');
    writeFileSync(path.join(fork, 'feature.txt'), 'from the fork\n');
    git(fork, 'add', '-A');
    git(fork, 'commit', '-m', 'add a feature');
    git(fork, 'push', '-q', headDir, 'feature');
    headSha = git(fork, 'rev-parse', 'HEAD');

    // the base moves on independently after the fork
    writeFileSync(path.join(work, 'upstream.txt'), 'upstream\n');
    git(work, 'add', '-A');
    git(work, 'commit', '-m', 'upstream moves on');
    git(work, 'push', '-q', baseDir, 'main');
    baseSha = git(work, 'rev-parse', 'HEAD');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('cannot see the other side without the alternate', async () => {
    await expect(
      mergeTree({ gitDir: baseDir, base: baseSha, head: headSha }),
    ).rejects.toThrow();
  });

  it('builds a pack a node that never saw the fork can replay', async () => {
    const alternates = [headDir];
    const tree = await mergeTree({
      gitDir: baseDir,
      alternates,
      base: baseSha,
      head: headSha,
    });
    expect(tree).toMatchObject({ clean: true, conflicts: [] });

    const mergeCommitSha = await commitTree({
      gitDir: baseDir,
      alternates,
      tree: tree.tree,
      parents: [baseSha, headSha],
      message: 'Merge pull request #1\n',
      author: { name: 'Test', email: 'test@example.com' },
    });

    const pack = await packRange({
      gitDir: baseDir,
      alternates,
      include: [mergeCommitSha],
      exclude: [baseSha],
      prefix: path.join(root, 'entry'),
    });
    expect(pack.size).toBeGreaterThan(0);

    // a cold node: the base repository's objects, then this entry, nothing else
    const cold = path.join(root, 'cold.git');
    execFileSync('git', ['init', '-q', '--bare', cold]);
    cpSync(path.join(baseDir, 'objects'), path.join(cold, 'objects'), {
      recursive: true,
    });
    execFileSync('git', ['index-pack', '--fix-thin', '--stdin'], {
      cwd: cold,
      env: { ...process.env, GIT_DIR: cold },
      input: execFileSync('cat', [pack.path], { maxBuffer: 1 << 28 }),
    });

    expect(git(cold, 'cat-file', '-t', mergeCommitSha)).toBe('commit');
    expect(git(cold, 'rev-list', '--count', mergeCommitSha).trim()).toBe('4');
    expect(
      git(cold, 'fsck', '--no-progress', '--connectivity-only'),
    ).not.toMatch(/missing/);
  });

  it('rebuilds the same test merge for the same pair, dated by its later parent', async () => {
    const pair = {
      gitDir: baseDir,
      alternates: [headDir],
      base: baseSha,
      head: headSha,
    };
    const first = await testMergeCommit(pair);
    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect(await testMergeCommit(pair)).toBe(first);
    const later = Math.max(
      Number(git(baseDir, 'log', '-1', '--format=%ct', baseSha)),
      Number(git(headDir, 'log', '-1', '--format=%ct', headSha)),
    );
    // the fork's side is only readable through the alternate the merge was built with
    const shown = execFileSync(
      'git',
      ['log', '-1', '--format=%P|%ct|%cn|%s', first!],
      {
        cwd: baseDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(headDir, 'objects'),
        },
      },
    ).trim();
    expect(shown).toBe(
      `${baseSha} ${headSha}|${later}|Ghost|Merge ${headSha} into ${baseSha}`,
    );
  });

  it('has no test merge for a pair that conflicts', async () => {
    const fork = path.join(root, 'fork');
    const work = path.join(root, 'work');
    writeFileSync(path.join(fork, 'clash.txt'), 'fork side\n');
    git(fork, 'add', '-A');
    git(fork, 'commit', '-m', 'fork edits');
    git(fork, 'push', '-q', headDir, 'feature');
    writeFileSync(path.join(work, 'clash.txt'), 'base side\n');
    git(work, 'add', '-A');
    git(work, 'commit', '-m', 'base edits');
    git(work, 'push', '-q', baseDir, 'main');

    expect(
      await testMergeCommit({
        gitDir: baseDir,
        alternates: [headDir],
        base: git(work, 'rev-parse', 'HEAD'),
        head: git(fork, 'rev-parse', 'HEAD'),
      }),
    ).toBeNull();
  });

  it('names the conflicted paths instead of throwing when the merge conflicts', async () => {
    const fork = path.join(root, 'fork');
    const work = path.join(root, 'work');

    writeFileSync(path.join(fork, 'clash.txt'), 'fork side\n');
    git(fork, 'add', '-A');
    git(fork, 'commit', '-m', 'fork edits');
    git(fork, 'push', '-q', headDir, 'feature');

    writeFileSync(path.join(work, 'clash.txt'), 'base side\n');
    git(work, 'add', '-A');
    git(work, 'commit', '-m', 'base edits');
    git(work, 'push', '-q', baseDir, 'main');

    expect(
      await mergeTree({
        gitDir: baseDir,
        alternates: [headDir],
        base: git(work, 'rev-parse', 'HEAD'),
        head: git(fork, 'rev-parse', 'HEAD'),
      }),
    ).toMatchObject({ clean: false, conflicts: ['clash.txt'] });
  });

  it('replays the head onto the base, keeping authors and dropping merge commits', async () => {
    const fork = path.join(root, 'fork');
    const work = path.join(root, 'work');
    writeFileSync(path.join(fork, 'second.txt'), 'second\n');
    git(fork, 'add', '-A');
    git(
      fork,
      'commit',
      '-m',
      'second commit',
      '-m',
      'with a body',
      '--author',
      'Alice <alice@example.com>',
    );
    git(fork, 'fetch', '-q', work, 'main');
    git(fork, 'merge', '-q', '--no-edit', 'FETCH_HEAD');
    git(fork, 'push', '-q', headDir, 'feature');
    const head = git(fork, 'rev-parse', 'HEAD');

    const rebased = await rebaseCommits({
      gitDir: baseDir,
      alternates: [headDir],
      onto: baseSha,
      from: git(fork, 'merge-base', 'HEAD', 'FETCH_HEAD'),
      to: head,
      committer: { name: 'Merger', email: 'merger@example.com' },
    });
    if (!rebased.clean) throw new Error('expected a clean rebase');

    const log = (format: string) =>
      git(baseDir, 'log', `--format=${format}`, `${baseSha}..${rebased.tip}`);
    expect(
      log('%P')
        .split('\n')
        .map((parents) => parents.split(' ').length),
    ).toEqual([1, 1]);
    expect(log('%an <%ae>|%cn')).toBe(
      'Alice <alice@example.com>|Merger\nTest <test@example.com>|Merger',
    );
    expect(git(baseDir, 'log', '-1', '--format=%B', rebased.tip)).toBe(
      'second commit\n\nwith a body',
    );
    expect(log('%ad').split('\n')[0]).toBe(
      git(fork, 'log', '-1', '--format=%ad', 'HEAD^'),
    );
    // merge-tree skips writing a tree the lent store already holds, so reading it back needs the same loan
    const tree = execFileSync('git', ['ls-tree', '--name-only', rebased.tip], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_DIR: baseDir,
        GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(headDir, 'objects'),
      },
    });
    expect(tree.trim().split('\n')).toEqual([
      'feature.txt',
      'second.txt',
      'shared.txt',
      'upstream.txt',
    ]);
  });

  it('names the conflicted paths of the first commit that cannot be replayed', async () => {
    const fork = path.join(root, 'fork');
    const work = path.join(root, 'work');
    writeFileSync(path.join(fork, 'clash.txt'), 'fork side\n');
    git(fork, 'add', '-A');
    git(fork, 'commit', '-m', 'fork edits');
    git(fork, 'push', '-q', headDir, 'feature');

    writeFileSync(path.join(work, 'clash.txt'), 'base side\n');
    git(work, 'add', '-A');
    git(work, 'commit', '-m', 'base edits');
    git(work, 'push', '-q', baseDir, 'main');

    expect(
      await rebaseCommits({
        gitDir: baseDir,
        alternates: [headDir],
        onto: git(work, 'rev-parse', 'HEAD'),
        from: git(work, 'rev-parse', 'HEAD~2'),
        to: git(fork, 'rev-parse', 'HEAD'),
        committer: { name: 'Merger', email: 'merger@example.com' },
      }),
    ).toEqual({ clean: false, conflicts: ['clash.txt'] });
  });
});

describe('commitTree with a signer', () => {
  it('writes a commit git accepts, signed over its own bytes', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'ghost-sign-'));
    const gitDir = path.join(root, 'repo.git');
    execFileSync('git', ['init', '-q', '--bare', gitDir]);
    const { privateKey, publicKey } = await openpgp.generateKey({
      userIDs: [{ name: 'Ghost', email: 'noreply@ghost.local' }],
      format: 'armored',
    });
    const signingKey = await openpgp.readPrivateKey({ armoredKey: privateKey });

    try {
      const sha = await commitTree({
        gitDir,
        // git's empty tree, which every repository can name without holding it
        tree: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
        parents: [],
        message: 'signed by the platform\n',
        author: { name: 'Test', email: 'test@example.com' },
        sign: (payload) => signPayload({ payload, privateKey: signingKey }),
      });

      execFileSync('git', ['fsck', '--no-progress', '--strict'], {
        env: { ...process.env, GIT_DIR: gitDir },
      });
      const signed = (await readSignedCommits({ gitDir, shas: [sha] })).get(
        sha,
      );
      expect(signed?.payload).toContain('signed by the platform');
      await expect(
        verifySignature({
          payload: signed!.payload,
          armoredSignature: signed!.signature,
          armoredKey: publicKey,
        }),
      ).resolves.toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
