import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listBranches } from './list-refs.js';

describe('listBranches', () => {
  let root: string;
  let gitDir: string;

  function git(...args: string[]) {
    const env = { ...process.env };
    delete env.GIT_DIR;
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env,
    }).trim();
  }

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-branches-'));
    gitDir = path.join(root, '.git');
    execFileSync('git', ['init', '-q', '-b', 'main', root]);
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function commit(message: string) {
    writeFileSync(path.join(root, 'file.txt'), message);
    git('add', '-A');
    git('commit', '-m', message);
  }

  it('returns nothing for a repository with no commits', async () => {
    expect(await listBranches(gitDir)).toEqual([]);
  });

  it('returns short branch names, ordered by name', async () => {
    commit('first');
    git('branch', 'feat/contents');
    git('branch', 'a-branch');

    expect(await listBranches(gitDir)).toEqual([
      'a-branch',
      'feat/contents',
      'main',
    ]);
  });

  it('does not mark the checked out branch', async () => {
    commit('first');
    git('checkout', '-q', '-b', 'feat');

    expect(await listBranches(gitDir)).toEqual(['feat', 'main']);
  });

  it('ignores tags and remote-tracking refs', async () => {
    commit('first');
    git('tag', 'v1.0.0');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');

    expect(await listBranches(gitDir)).toEqual(['main']);
  });

  it('names a branch in full when a tag shares its name', async () => {
    commit('first');
    git('branch', 'v1');
    git('tag', 'v1');

    expect(await listBranches(gitDir)).toEqual(['main', 'v1']);
  });
});
