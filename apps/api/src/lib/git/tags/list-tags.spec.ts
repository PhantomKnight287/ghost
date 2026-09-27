import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTagObject } from './create-tag.js';
import { isValidTagName, listTags } from './list-tags.js';

describe('listTags', () => {
  let root: string;
  let gitDir: string;
  let git: (...args: string[]) => string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-tags-'));
    gitDir = path.join(root, '.git');
    const env = { ...process.env };
    delete env.GIT_DIR;
    git = (...args) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8', env });

    execFileSync('git', ['init', '-q', '-b', 'main', root]);
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const commit = (message: string, date: string) => {
    writeFileSync(path.join(root, 'README.md'), `${message}\n`);
    git('add', '-A');
    execFileSync('git', ['commit', '-q', '-m', message], {
      cwd: root,
      env: {
        ...process.env,
        GIT_DIR: gitDir,
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      },
    });
    return git('rev-parse', 'HEAD').trim();
  };

  it('returns nothing for a repository without tags', async () => {
    commit('first', '2026-01-01T00:00:00Z');
    await expect(listTags(gitDir)).resolves.toEqual([]);
  });

  it('lists lightweight and annotated tags newest first, peeled to their commit', async () => {
    const first = commit('first', '2026-01-01T00:00:00Z');
    git('tag', 'v1.0');
    const second = commit('second', '2026-02-01T00:00:00Z');
    execFileSync('git', ['tag', '-a', 'release/v2.0', '-m', 'Second release'], {
      cwd: root,
      env: {
        ...process.env,
        GIT_DIR: gitDir,
        GIT_COMMITTER_DATE: '2026-03-01T00:00:00Z',
      },
    });

    await expect(listTags(gitDir)).resolves.toEqual([
      {
        name: 'release/v2.0',
        sha: second,
        message: 'Second release',
        createdAt: '2026-03-01T00:00:00.000Z',
      },
      {
        name: 'v1.0',
        sha: first,
        message: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });
  it('leaves out tags of trees and blobs, and peels a tag of a tag to its commit', async () => {
    const sha = commit('first', '2026-01-01T00:00:00Z');
    git('tag', 'v1.0');
    git('tag', 'on-tree', 'HEAD^{tree}');
    git('tag', 'on-blob', 'HEAD:README.md');
    git('tag', '-a', 'inner', 'v1.0', '-m', 'inner');
    git('tag', '-a', 'nested', 'inner', '-m', 'outer');

    const tags = await listTags(gitDir);
    expect(
      tags
        .map(({ name, sha }) => [name, sha])
        .sort(([a], [b]) => a.localeCompare(b)),
    ).toEqual([
      ['inner', sha],
      ['nested', sha],
      ['v1.0', sha],
    ]);
  });

  it('dates a tag written without a tagger at the epoch instead of failing', async () => {
    const sha = commit('first', '2026-01-01T00:00:00Z');
    const oid = execFileSync(
      'git',
      ['hash-object', '-t', 'tag', '-w', '--stdin', '--literally'],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, GIT_DIR: gitDir },
        input: `object ${sha}\ntype commit\ntag old\n\nNo tagger\n`,
      },
    ).trim();
    git('update-ref', 'refs/tags/old', oid);

    await expect(listTags(gitDir)).resolves.toEqual([
      {
        name: 'old',
        sha,
        message: 'No tagger',
        createdAt: '1970-01-01T00:00:00.000Z',
      },
    ]);
  });
});

describe('isValidTagName', () => {
  it('accepts names git accepts, including a slash', async () => {
    for (const name of ['v1.0.0', 'release/2026-09']) {
      await expect(isValidTagName(name)).resolves.toBe(true);
    }
  });

  it('refuses flags, revision syntax and empty names', async () => {
    for (const name of [
      '',
      '-all',
      '--delete',
      'v1..2',
      'v1^{tree}',
      'a b',
      'v1.lock',
      'x~1',
    ]) {
      await expect(isValidTagName(name)).resolves.toBe(false);
    }
  });
});

describe('createTagObject', () => {
  it('writes an annotated tag that lists with its own date and message', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'ghost-mktag-'));
    const gitDir = path.join(root, '.git');
    const env = { ...process.env };
    delete env.GIT_DIR;
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8', env }).trim();

    try {
      execFileSync('git', ['init', '-q', '-b', 'main', root]);
      git('config', 'user.email', 'test@example.com');
      git('config', 'user.name', 'Test');
      writeFileSync(path.join(root, 'README.md'), 'hello\n');
      git('add', '-A');
      git('commit', '-q', '-m', 'first');
      const sha = git('rev-parse', 'HEAD');

      const oid = await createTagObject({
        gitDir,
        sha,
        name: 'v1.0.0',
        message: 'First release',
        tagger: { name: 'Ghost <admin>', email: 'ghost@example.com' },
        date: new Date('2026-09-27T10:00:00Z'),
      });
      git('update-ref', 'refs/tags/v1.0.0', oid);

      expect(git('cat-file', '-p', oid)).toContain(
        'tagger Ghost admin <ghost@example.com> 1790503200 +0000',
      );
      await expect(listTags(gitDir)).resolves.toEqual([
        {
          name: 'v1.0.0',
          sha,
          message: 'First release',
          createdAt: '2026-09-27T10:00:00.000Z',
        },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
