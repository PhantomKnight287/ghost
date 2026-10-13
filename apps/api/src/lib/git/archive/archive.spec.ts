import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buffer } from 'node:stream/consumers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { archiveName, streamArchive } from './archive.js';

describe('archiveName', () => {
  it('names the folder after the repository and ref, with a branch on one segment', () => {
    expect(archiveName('ghost', 'refs/heads/main')).toBe('ghost-main');
    expect(archiveName('ghost', 'feat/archives')).toBe('ghost-feat-archives');
    expect(archiveName('ghost', 'v1.0.0')).toBe('ghost-v1.0.0');
    expect(archiveName('ghost', '../../etc')).toBe('ghost-..-..-etc');
  });
});

describe('streamArchive', () => {
  let work: string;
  let commit: string;

  beforeAll(() => {
    work = mkdtempSync(path.join(tmpdir(), 'ghost-archive-'));
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args],
        { cwd: work },
      )
        .toString()
        .trim();
    git('init', '-q', '-b', 'main');
    writeFileSync(path.join(work, 'a.txt'), 'one\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    commit = git('rev-parse', 'HEAD');
  });

  afterAll(() => rmSync(work, { recursive: true, force: true }));

  const gitDir = () => path.join(work, '.git');

  it('zips the tree under one top-level folder', async () => {
    const zip = await buffer(
      streamArchive({
        gitDir: gitDir(),
        commit,
        format: 'zip',
        prefix: 'r-main',
      }),
    );
    expect(zip.subarray(0, 2).toString()).toBe('PK');
    expect(zip.includes('r-main/a.txt')).toBe(true);
  });

  it('gzips a tarball', async () => {
    const tarball = await buffer(
      streamArchive({
        gitDir: gitDir(),
        commit,
        format: 'tar.gz',
        prefix: 'r',
      }),
    );
    expect([...tarball.subarray(0, 2)]).toEqual([0x1f, 0x8b]);
  });

  it('fails the stream for a commit that is not there', async () => {
    const stream = streamArchive({
      gitDir: gitDir(),
      commit: '0'.repeat(40),
      format: 'zip',
      prefix: 'r',
    });
    await expect(buffer(stream)).rejects.toThrow();
  });
});
