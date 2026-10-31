import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findReadmePath } from './find-readme.js';

describe('findReadmePath', () => {
  let root: string;
  let gitDir: string;
  let git: (...args: string[]) => string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-readme-'));
    gitDir = path.join(root, '.git');
    const env = { ...process.env };
    delete env.GIT_DIR;
    git = (...args: string[]) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8', env });

    execFileSync('git', ['init', '-q', '-b', 'main', root]);
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const commit = (files: Record<string, string>) => {
    for (const [file, contents] of Object.entries(files)) {
      mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
      writeFileSync(path.join(root, file), contents);
    }
    git('add', '-A');
    git('commit', '-q', '-m', 'commit');
  };

  it('finds the root README', async () => {
    commit({ 'README.md': 'hi\n' });

    expect(await findReadmePath({ gitDir, ref: 'main' })).toBe('README.md');
  });

  it('matches any casing', async () => {
    commit({ 'ReadMe.MD': 'hi\n' });

    expect(await findReadmePath({ gitDir, ref: 'main' })).toBe('ReadMe.MD');
  });

  it('prefers the markdown one over the extensionless one', async () => {
    commit({ README: 'plain\n', 'README.md': 'rendered\n' });

    expect(await findReadmePath({ gitDir, ref: 'main' })).toBe('README.md');
  });

  it('ignores a directory named like a README', async () => {
    commit({ 'readme/notes.txt': 'x\n' });

    expect(await findReadmePath({ gitDir, ref: 'main' })).toBeNull();
  });

  it('never looks below the directory it was given', async () => {
    commit({ 'docs/README.md': 'nested\n', 'src/x.ts': 'x\n' });

    expect(await findReadmePath({ gitDir, ref: 'main' })).toBeNull();
    expect(await findReadmePath({ gitDir, ref: 'main', prefix: 'docs/' })).toBe(
      'docs/README.md',
    );
  });

  it('is null on a ref that does not exist', async () => {
    expect(await findReadmePath({ gitDir, ref: 'main' })).toBeNull();
  });
});
