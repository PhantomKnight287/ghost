import { execFile, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ArchivesBusyError } from '../src/lib/repositories/repositories.errors.js';
import { RepositoriesService } from '../src/resources/repositories/repositories.service.js';
import { hasBackends, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)('source archives', () => {
  let app: INestApplication;
  let work: string;
  let owner: { cookie: string; key: string; userId: string };
  const username = `archives${Date.now()}`;
  const http = () => request(app.getHttpServer());
  const archive = (repo: string, query: Record<string, string>) =>
    http()
      .get(`/api/repositories/${username}/${repo}/archive`)
      .query(query)
      .responseType('blob');
  const github = (route: string) =>
    http()
      .get(`/api/v3/repos/${username}/tools/${route}`)
      .set('authorization', `token ${owner.key}`)
      .responseType('blob');

  beforeAll(async () => {
    let origin: string;
    ({ app, origin } = await startApp());
    owner = await signUp(app, username);
    for (const [name, visibility] of [
      ['tools', 'public'],
      ['secret', 'private'],
      ['empty', 'public'],
    ]) {
      await http()
        .post('/api/repositories')
        .set('cookie', owner.cookie)
        .send({ name, visibility })
        .expect(201);
    }

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-archives-'));
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
        { cwd: work },
      );
    git('init', '-q', '-b', 'main');
    writeFileSync(path.join(work, 'a.txt'), 'one\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    git('tag', 'v1.0');
    git('checkout', '-q', '-b', 'feat/archives');
    writeFileSync(path.join(work, 'b.txt'), 'two\n');
    git('add', '.');
    git('commit', '-q', '-m', 'second');

    const remote = (repo: string) =>
      `${origin.replace('://', `://${username}:${owner.key}@`)}/${username}/${repo}.git`;
    // The server runs in this process, so the push must not block the event loop.
    for (const [repo, refs] of [
      ['tools', ['main', 'feat/archives', 'v1.0']],
      ['secret', ['main']],
    ] as const) {
      await promisify(execFile)('git', ['push', '-q', remote(repo), ...refs], {
        cwd: work,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
    }
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('archives the default branch under a folder named for it', async () => {
    const zip = await archive('tools', { format: 'zip' }).expect(200);

    expect(zip.headers['content-disposition']).toBe(
      'attachment; filename="tools-main.zip"',
    );
    expect((zip.body as Buffer).includes('tools-main/a.txt')).toBe(true);
  });

  it('archives a branch with a slash on one folder, revalidated since it moves', async () => {
    const tarball = await archive('tools', {
      format: 'tar.gz',
      ref: 'feat/archives',
    }).expect(200);

    expect(tarball.headers).toMatchObject({
      'content-type': 'application/gzip',
      'content-disposition':
        'attachment; filename="tools-feat-archives.tar.gz"',
      'cache-control': 'private, no-cache',
    });
  });

  it('keeps a tag forever and answers its revalidation with 304', async () => {
    const zip = await archive('tools', { format: 'zip', ref: 'v1.0' }).expect(
      200,
    );
    expect(zip.headers['cache-control']).toContain('immutable');

    await archive('tools', { format: 'zip', ref: 'v1.0' })
      .set('if-none-match', zip.headers.etag)
      .expect(304);
  });

  it('refuses an unknown ref or format, and a repository with no commits', async () => {
    await archive('tools', { format: 'zip', ref: 'missing' }).expect(404);
    await archive('tools', { format: 'rar' }).expect(400);
    await archive('empty', { format: 'zip' }).expect(404);
  });

  it('asks an anonymous caller to sign in for a private repository', async () => {
    await archive('secret', { format: 'zip' }).expect(401);
    await archive('secret', { format: 'zip' })
      .set('cookie', owner.cookie)
      .expect(200);
  });

  it('serves GitHub zipball and tarball at a ref with slashes, or the default branch', async () => {
    const branch = await github('zipball/feat/archives').expect(200);
    expect(branch.headers['content-disposition']).toBe(
      'attachment; filename="tools-feat-archives.zip"',
    );
    expect((branch.body as Buffer).includes('tools-feat-archives/b.txt')).toBe(
      true,
    );

    const qualified = await github('tarball/refs/heads/feat/archives').expect(
      200,
    );
    expect(qualified.headers['content-disposition']).toBe(
      'attachment; filename="tools-feat-archives.tar.gz"',
    );

    const fallback = await github('zipball').expect(200);
    expect(fallback.headers['content-disposition']).toBe(
      'attachment; filename="tools-main.zip"',
    );
  });

  it("serves a release's archives from storage, with their length, and counts each download", async () => {
    await http()
      .post(`/api/repositories/${username}/tools/releases`)
      .set('cookie', owner.cookie)
      .send({ tagName: 'v1.0' })
      .expect(201);

    const zip = await archive('tools', { format: 'zip', ref: 'v1.0' }).expect(
      200,
    );
    expect(Number(zip.headers['content-length'])).toBe(
      (zip.body as Buffer).length,
    );
    await github('tarball/v1.0').expect(200);

    const { body: release } = await http()
      .get(`/api/repositories/${username}/tools/releases/tags/v1.0`)
      .expect(200);
    expect(release.source).toEqual({
      zipball: { size: (zip.body as Buffer).length, downloadCount: 1 },
      tarball: { size: expect.any(Number), downloadCount: 1 },
    });
  });

  it('turns callers away while two archives are being built, until one finishes', async () => {
    const repositories = app.get(RepositoriesService);
    const tools = await repositories.getArchive({
      username,
      repo: 'tools',
      format: 'zip',
    });

    const { stream: first } = await tools.open();
    const { stream: second } = await tools.open();
    await expect(tools.open()).rejects.toThrow(ArchivesBusyError);

    first.destroy();
    await once(first, 'close');
    const { stream: third } = await tools.open();

    second.destroy();
    third.destroy();
  });
});
