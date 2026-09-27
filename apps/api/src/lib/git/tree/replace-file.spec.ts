import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { replaceFile } from './replace-file.js';

describe('replaceFile', () => {
  let root: string;
  let gitDir: string;
  let parent: string;
  let git: (...args: string[]) => string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-replace-'));
    gitDir = path.join(root, '.git');
    const env = { ...process.env };
    delete env.GIT_DIR;
    git = (...args) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8', env }).trim();

    execFileSync('git', ['init', '-q', '-b', 'main', root]);
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    mkdirSync(path.join(root, 'bin'));
    writeFileSync(path.join(root, 'bin', 'run'), 'echo old\n');
    chmodSync(path.join(root, 'bin', 'run'), 0o755);
    writeFileSync(path.join(root, 'other.txt'), 'untouched\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'first');
    parent = git('rev-parse', 'HEAD');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('commits the new content on top of the parent, keeping the mode and every other file', async () => {
    const commit = await replaceFile({
      gitDir,
      parent,
      file: 'bin/run',
      content: Buffer.from('echo new\n'),
      message: 'Apply suggestion',
      author: { name: 'Reviewer', email: 'reviewer@example.com' },
    });

    expect(git('show', `${commit}:bin/run`)).toBe('echo new');
    expect(git('show', `${commit}:other.txt`)).toBe('untouched');
    expect(git('rev-parse', `${commit}^`)).toBe(parent);
    expect(git('ls-tree', commit, '--', 'bin/run').split(' ')[0]).toBe(
      '100755',
    );
    expect(git('log', '-1', '--format=%an %s', commit)).toBe(
      'Reviewer Apply suggestion',
    );
    // The working index was never touched.
    expect(git('status', '--porcelain')).toBe('');
  });
});
