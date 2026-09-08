import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listDiffFiles, mergeBase } from './diff.js';

describe('listDiffFiles', () => {
  let root: string;
  let gitDir: string;
  let from: string;
  let to: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-diff-'));
    gitDir = path.join(root, '.git');
    const env = { ...process.env };
    delete env.GIT_DIR;
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8', env }).trim();

    execFileSync('git', ['init', '-q', '-b', 'main', root]);
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');

    writeFileSync(path.join(root, 'keep.txt'), 'one\ntwo\n');
    writeFileSync(path.join(root, 'gone.txt'), 'bye\n');
    git('add', '-A');
    git('commit', '-m', 'first');
    from = git('rev-parse', 'HEAD');

    writeFileSync(path.join(root, 'keep.txt'), 'one\ntwo\nthree\n');
    rmSync(path.join(root, 'gone.txt'));
    writeFileSync(path.join(root, 'added.txt'), 'new\n');
    writeFileSync(path.join(root, 'logo.bin'), Buffer.from([0, 1, 2, 0, 3]));
    git('add', '-A');
    git('commit', '-m', 'second');
    to = git('rev-parse', 'HEAD');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reports a status and line counts per path', async () => {
    const files = await listDiffFiles({ gitDir, from, to });
    const byPath = Object.fromEntries(files.map((file) => [file.path, file]));

    expect(files).toHaveLength(4);
    expect(byPath['keep.txt']).toMatchObject({
      status: 'M',
      additions: 1,
      deletions: 0,
      binary: false,
    });
    expect(byPath['added.txt']).toMatchObject({ status: 'A', additions: 1 });
    expect(byPath['gone.txt']).toMatchObject({ status: 'D', deletions: 1 });
  });

  it('marks a binary file instead of inventing line counts', async () => {
    const files = await listDiffFiles({ gitDir, from, to });
    expect(files.find((file) => file.path === 'logo.bin')).toMatchObject({
      status: 'A',
      additions: 0,
      deletions: 0,
      binary: true,
    });
  });

  it('has no merge base for unrelated histories', async () => {
    const orphan = execFileSync(
      'git',
      ['commit-tree', `${to}^{tree}`, '-m', 'orphan'],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_DIR: gitDir,
          GIT_AUTHOR_NAME: 'T',
          GIT_AUTHOR_EMAIL: 't@t',
          GIT_COMMITTER_NAME: 'T',
          GIT_COMMITTER_EMAIL: 't@t',
        },
      },
    ).trim();

    expect(await mergeBase({ gitDir, a: to, b: orphan })).toBeNull();
    expect(await mergeBase({ gitDir, a: from, b: to })).toBe(from);
  });
});
