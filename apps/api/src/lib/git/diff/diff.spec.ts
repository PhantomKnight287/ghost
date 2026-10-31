import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fileHunks, listDiffFiles, mergeBase, parseHunks } from './diff.js';

describe('listDiffFiles with submodules', () => {
  let root: string;
  let gitDir: string;
  let git: (...args: string[]) => string;
  const pinned = (n: string) => n.repeat(40);

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-diff-submodules-'));
    gitDir = path.join(root, '.git');
    const env = { ...process.env };
    delete env.GIT_DIR;
    git = (...args: string[]) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8', env }).trim();

    execFileSync('git', ['init', '-q', '-b', 'main', root]);
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  // a gitlink in the index is all a commit needs; the submodule's own objects never enter the superproject
  const commit = (gitlinks: Record<string, string>, files: string[] = []) => {
    git('read-tree', '--empty');
    for (const [where, sha] of Object.entries(gitlinks)) {
      git('update-index', '--add', '--cacheinfo', `160000,${sha},${where}`);
    }
    for (const file of files) {
      writeFileSync(path.join(root, file), `${file}\n`);
      git('update-index', '--add', file);
    }
    git('commit', '-q', '--allow-empty', '-m', 'snapshot');
    return git('rev-parse', 'HEAD');
  };

  it('reports the pinned commit on each side of an added, moved and removed submodule', async () => {
    const from = commit({ moved: pinned('a'), removed: pinned('b') }, [
      'kept.txt',
    ]);
    const to = commit({ moved: pinned('c'), added: pinned('d') }, [
      'kept.txt',
      'new.txt',
    ]);

    const files = await listDiffFiles({ gitDir, from, to });

    expect(files).toEqual([
      expect.objectContaining({
        path: 'added',
        status: 'A',
        submodule: { from: null, to: pinned('d') },
      }),
      expect.objectContaining({
        path: 'moved',
        status: 'M',
        submodule: { from: pinned('a'), to: pinned('c') },
      }),
      expect.objectContaining({
        path: 'new.txt',
        status: 'A',
        submodule: null,
      }),
      expect.objectContaining({
        path: 'removed',
        status: 'D',
        submodule: { from: pinned('b'), to: null },
      }),
    ]);
  });

  it('keeps only the submodule side when a file becomes a submodule', async () => {
    const from = commit({}, ['vendor']);
    const to = commit({ vendor: pinned('e') });

    expect(await listDiffFiles({ gitDir, from, to })).toEqual([
      expect.objectContaining({
        path: 'vendor',
        status: 'T',
        submodule: { from: null, to: pinned('e') },
      }),
    ]);
  });
});

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

  it('reads a file’s hunks with both line numbers on every line', async () => {
    const [hunk] = await fileHunks({ gitDir, from, to, path: 'keep.txt' });
    expect(hunk).toEqual({
      deletions: [1, 2],
      additions: [1, 3],
      lines: [
        { kind: ' ', old: 1, new: 1, text: 'one' },
        { kind: ' ', old: 2, new: 2, text: 'two' },
        { kind: '+', old: 3, new: 3, text: 'three' },
      ],
    });
    expect(await fileHunks({ gitDir, from, to, path: 'logo.bin' })).toEqual([]);
  });
});

describe('parseHunks', () => {
  it('counts a removed line that reads like a file header as part of the hunk', () => {
    const [hunk] = parseHunks(
      '--- a/x\n+++ b/x\n@@ -1,2 +1 @@\n--- not a header\n keep\n\\ No newline at end of file\n',
    );
    expect(hunk.lines).toEqual([
      { kind: '-', old: 1, new: 1, text: '-- not a header' },
      { kind: ' ', old: 2, new: 1, text: 'keep' },
    ]);
    expect(hunk.additions).toEqual([1, 1]);
  });
});
