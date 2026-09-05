import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listTree, orderTreeEntries, type TreeEntry } from './list-tree.js';

describe('listTree', () => {
  let root: string;
  let gitDir: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-tree-'));
    gitDir = path.join(root, '.git');
    const env = { ...process.env };
    delete env.GIT_DIR;
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8', env });

    execFileSync('git', ['init', '-q', '-b', 'main', root]);
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    mkdirSync(path.join(root, 'src/deep'), { recursive: true });
    writeFileSync(path.join(root, 'README.md'), 'hello\n');
    writeFileSync(path.join(root, 'src/deep/x.ts'), 'x\n');
    git('add', '-A');
    git('commit', '-m', 'first commit');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('lists one level of the root with sizes for blobs', async () => {
    const entries = await listTree({ gitDir, ref: 'main', prefix: '' });

    expect(entries).toEqual([
      expect.objectContaining({
        type: 'tree',
        name: 'src',
        path: 'src',
        size: null,
      }),
      expect.objectContaining({
        type: 'blob',
        name: 'README.md',
        path: 'README.md',
        size: 6,
        mode: '100644',
      }),
    ]);
  });

  it('strips the prefix from names but keeps full paths', async () => {
    const entries = await listTree({ gitDir, ref: 'main', prefix: 'src/' });

    expect(entries).toEqual([
      expect.objectContaining({ name: 'deep', path: 'src/deep', type: 'tree' }),
    ]);
  });

  /**
   * Git reads a leading ":" as pathspec magic, and ":/" means "from the root".
   * Without :(literal) this listing would quietly return the root instead of
   * the directory that was asked for.
   */
  it('does not let pathspec magic escape the requested directory', async () => {
    const entries = await listTree({ gitDir, ref: 'main', prefix: ':/' });
    expect(entries).toEqual([]);
  });

  it('treats glob magic as a literal name', async () => {
    const entries = await listTree({
      gitDir,
      ref: 'main',
      prefix: ':(glob)**/',
    });
    expect(entries).toEqual([]);
  });

  it('returns nothing for a path that is a file rather than a directory', async () => {
    const entries = await listTree({
      gitDir,
      ref: 'main',
      prefix: 'README.md/',
    });
    expect(entries).toEqual([]);
  });

  it('rejects a ref that does not exist', async () => {
    await expect(
      listTree({ gitDir, ref: 'refs/heads/nope', prefix: '' }),
    ).rejects.toThrow();
  });

  it('does not treat a ref starting with a dash as an option', async () => {
    // --end-of-options makes this a bad revision rather than a parsed flag
    await expect(
      listTree({ gitDir, ref: '--output=/tmp/pwned', prefix: '' }),
    ).rejects.toThrow(/not a valid object name/i);
  });
});

describe('orderTreeEntries', () => {
  const entry = (name: string, type: TreeEntry['type']) =>
    ({ name, type, path: name, mode: '', oid: '', size: null }) as TreeEntry;

  it('puts directories before files, each group alphabetical', () => {
    const ordered = orderTreeEntries([
      entry('README.md', 'blob'),
      entry('zeta', 'tree'),
      entry('alpha.txt', 'blob'),
      entry('Alpha', 'tree'),
    ]);

    // "alpha.txt" before "README.md": alphabetical, not the byte order that
    // would hoist every capitalized name to the front
    expect(ordered.map((e) => e.name)).toEqual([
      'Alpha',
      'zeta',
      'alpha.txt',
      'README.md',
    ]);
  });

  it('groups submodules with directories', () => {
    const ordered = orderTreeEntries([
      entry('a.txt', 'blob'),
      entry('vendor', 'commit'),
    ]);

    expect(ordered.map((e) => e.name)).toEqual(['vendor', 'a.txt']);
  });

  it('interleaves case instead of blocking uppercase first', () => {
    // byte order would give Alpha, Beta.md, alpha.txt
    const ordered = orderTreeEntries([
      entry('Beta.md', 'blob'),
      entry('alpha.txt', 'blob'),
      entry('Alpha', 'blob'),
    ]);

    expect(ordered.map((e) => e.name)).toEqual([
      'Alpha',
      'alpha.txt',
      'Beta.md',
    ]);
  });

  it('orders embedded numbers naturally', () => {
    const ordered = orderTreeEntries([
      entry('file10.ts', 'blob'),
      entry('file2.ts', 'blob'),
    ]);

    expect(ordered.map((e) => e.name)).toEqual(['file2.ts', 'file10.ts']);
  });

  /**
   * Git stores trees as if their names ended in "/", so "src.d" sorts ahead of
   * "src" in the raw listing. Sorting by name puts that right.
   */
  it('corrects git own prefix ordering for directories', () => {
    const ordered = orderTreeEntries([
      entry('src.d', 'tree'),
      entry('src', 'tree'),
    ]);

    expect(ordered.map((e) => e.name)).toEqual(['src', 'src.d']);
  });
});
