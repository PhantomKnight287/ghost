import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listCommits, readCommit } from './list-commits.js';

describe('listCommits', () => {
  let root: string;
  let gitDir: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-log-'));
    gitDir = path.join(root, '.git');
    const env = { ...process.env };
    delete env.GIT_DIR;
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8', env });

    execFileSync('git', ['init', '-q', '-b', 'main', root]);
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    mkdirSync(path.join(root, 'src'), { recursive: true });

    writeFileSync(path.join(root, 'README.md'), 'hello\n');
    git('add', '-A');
    git('commit', '-m', 'first');

    writeFileSync(path.join(root, 'src/x.ts'), 'x\n');
    git('add', '-A');
    git('commit', '-m', 'second', '-m', 'with a body');

    writeFileSync(path.join(root, 'README.md'), 'hello again\n');
    git('add', '-A');
    git('commit', '-m', 'third');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('lists newest first', async () => {
    const { commits, nextCursor } = await listCommits({
      gitDir,
      ref: 'main',
      limit: 10,
    });

    expect(commits.map((c) => c.subject)).toEqual(['third', 'second', 'first']);
    expect(commits[1].body).toBe('with a body');
    expect(commits[0].authorName).toBe('Test');
    expect(nextCursor).toBeNull();
  });

  it('pages with the cursor', async () => {
    const first = await listCommits({ gitDir, ref: 'main', limit: 2 });
    expect(first.commits.map((c) => c.subject)).toEqual(['third', 'second']);

    const second = await listCommits({
      gitDir,
      ref: 'main',
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.commits.map((c) => c.subject)).toEqual(['first']);
    expect(second.nextCursor).toBeNull();
  });

  it('narrows to a path', async () => {
    const { commits } = await listCommits({
      gitDir,
      ref: 'main',
      path: 'src',
      limit: 10,
    });

    expect(commits.map((c) => c.subject)).toEqual(['second']);
  });

  it('reads one commit with its changed paths', async () => {
    const { commits } = await listCommits({ gitDir, ref: 'main', limit: 1 });
    const commit = await readCommit({ gitDir, sha: commits[0].sha });

    expect(commit?.subject).toBe('third');
    expect(commit?.files).toEqual([{ status: 'M', path: 'README.md' }]);
  });

  it('returns null for an unknown sha', async () => {
    expect(await readCommit({ gitDir, sha: 'deadbeef' })).toBeNull();
  });
});
