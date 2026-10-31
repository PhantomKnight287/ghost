import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { walkCommits, type CommitRecord } from './commit-log.js';

describe('walkCommits', () => {
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

  function commit(file: string, contents: string, message: string) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), contents);
    git('add', file);
    git('commit', '-m', message);
    return git('rev-parse', 'HEAD');
  }

  async function collect(range: string, pathspec?: string) {
    const records: CommitRecord[] = [];
    for await (const record of walkCommits({ gitDir, range, pathspec })) {
      records.push(record);
    }
    return records;
  }

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-log-'));
    gitDir = path.join(root, '.git');
    execFileSync('git', ['init', '-q', '-b', 'main', root]);
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('yields commits oldest first with the paths each one touched', async () => {
    commit('README.md', 'a', 'first commit');
    commit('src/deep/x.ts', 'b', 'add x');

    const records = await collect('main');

    expect(records.map((r) => r.subject)).toEqual(['first commit', 'add x']);
    expect(records[0].paths).toEqual(['README.md']);
    expect(records[1].paths).toEqual(['src/deep/x.ts']);
  });

  it('reports the committer timestamp', async () => {
    commit('README.md', 'a', 'first commit');
    const [record] = await collect('main');

    const seconds = Number(git('log', '-1', '--format=%ct'));
    expect(record.committedAt).toEqual(new Date(seconds * 1000));
    expect(record.sha).toBe(git('rev-parse', 'HEAD'));
  });

  it('walks only the commits a range adds', async () => {
    const base = commit('README.md', 'a', 'first commit');
    commit('src/y.ts', 'b', 'add y');

    const records = await collect(`${base}..main`);
    expect(records.map((r) => r.subject)).toEqual(['add y']);
  });

  it('attributes a merged file to the commit that wrote it, not the merge', async () => {
    commit('README.md', 'a', 'first commit');
    git('checkout', '-q', '-b', 'feat');
    commit('src/z.ts', 'c', 'add z on branch');
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', 'feat', '-m', 'merge feat');

    const records = await collect('main');
    const touchedZ = records.filter((r) => r.paths.includes('src/z.ts'));

    expect(touchedZ.map((r) => r.subject)).toEqual(['add z on branch']);
    // the merge is still yielded, it just claims no paths of its own
    expect(records.at(-1)).toMatchObject({ subject: 'merge feat', paths: [] });
  });

  it('keeps subjects intact and survives paths that need quoting', async () => {
    commit(
      'a file "with quotes".txt',
      'a',
      'subject: with punctuation, and more',
    );

    const [record] = await collect('main');
    expect(record.subject).toBe('subject: with punctuation, and more');
    expect(record.paths).toEqual(['a file "with quotes".txt']);
  });

  it('restricts the walk to a pathspec', async () => {
    commit('README.md', 'a', 'first commit');
    commit('src/y.ts', 'b', 'add y');

    const records = await collect('main', 'src/');
    expect(records.map((r) => r.subject)).toEqual(['add y']);
  });

  it('yields nothing for an empty range', async () => {
    commit('README.md', 'a', 'first commit');
    expect(await collect('main..main')).toEqual([]);
  });
});
