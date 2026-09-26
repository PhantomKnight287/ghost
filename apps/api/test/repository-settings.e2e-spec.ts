import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { WalStoreService } from '../src/services/git/wal/wal-store.service.js';
import { S3Service } from '../src/services/s3/s3.service.js';
import { hasBackends, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)('repository settings', () => {
  let app: INestApplication;
  let origin: string;
  let owner: { cookie: string; key: string };
  let stranger: { cookie: string; key: string };
  let work: string;
  const username = `settings${Date.now()}`;
  let repo: string;

  const api = () => request(app.getHttpServer());
  const at = (slug = repo) => `/api/repositories/${username}/${slug}`;
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  // The server runs in this process, so anything that talks to it must not block the event loop.
  const remote = (cwd: string, ...args: string[]) =>
    promisify(execFile)('git', args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  const remoteUrl = () =>
    `${origin.replace('://', `://${username}:${owner.key}@`)}/${username}/${repo}.git`;
  const update = (body: object, cookie = owner.cookie) =>
    api().patch(at()).set('cookie', cookie).send(body);
  const commit = (message: string) =>
    git(
      work,
      '-c',
      'user.name=E2E',
      '-c',
      'user.email=e2e@example.com',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      message,
    );
  const repositoryId = async () =>
    (await api().get(at()).set('cookie', owner.cookie).expect(200)).body
      .id as string;
  const storedKeys = async (id: string) => {
    const s3 = app.get(S3Service);
    const listed = await s3.listObjectsV2({
      Bucket: s3.bucket,
      Prefix: `repos/${id}/`,
    });
    return (listed.Contents ?? []).map((object) => object.Key);
  };
  const cacheOf = (id: string) => path.join(tmpdir(), 'ghost', `${id}.git`);

  beforeAll(async () => {
    ({ app, origin } = await startApp());
    owner = await signUp(app, username);
    stranger = await signUp(app, `${username}x`);

    const created = await api()
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: 'settings', visibility: 'public' })
      .expect(201);
    repo = created.body.slug;

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-settings-'));
    git(work, 'init', '-q', '-b', 'main');
    commit('first');
    git(work, 'branch', 'dev');
    await remote(work, 'push', '-q', remoteUrl(), 'main', 'dev');
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('turns away everyone but the owner', async () => {
    await update({ description: 'mine now' }, stranger.cookie).expect(403);
    await api().delete(at()).set('cookie', stranger.cookie).expect(403);
  });

  it('refuses a default branch the repository does not have', async () => {
    await update({ defaultBranch: 'nope' }).expect(404);
  });

  it('serves and clones the chosen default branch', async () => {
    await update({ defaultBranch: 'dev' }).expect(200);

    const branches = await api().get(`${at()}/branches`).expect(200);
    expect(branches.body.defaultBranch).toBe('dev');

    const clone = path.join(work, 'clone');
    await remote(work, 'clone', '-q', remoteUrl(), clone);
    expect(git(clone, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('dev');
  });

  it('updates description and visibility without touching the slug', async () => {
    await update({ description: 'settled', visibility: 'private' })
      .expect(200)
      .expect(({ body }) => expect(body.slug).toBe(repo));

    const { body } = await api()
      .get(at())
      .set('cookie', owner.cookie)
      .expect(200);
    expect(body).toMatchObject({
      description: 'settled',
      visibility: 'private',
    });
    await api().get(at()).expect(401);
  });

  it('keeps the slug when renamed to the same name', async () => {
    await update({ name: 'settings' })
      .expect(200)
      .expect(({ body }) => expect(body.slug).toBe(repo));

    // A clash on creation gave this one a suffixed slug; saving it unchanged must not hand it another.
    const { body: twin } = await api()
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: 'settings' })
      .expect(201);
    expect(twin.slug).not.toBe(repo);
    await api()
      .patch(at(twin.slug))
      .set('cookie', owner.cookie)
      .send({ name: 'settings', description: 'twin' })
      .expect(200)
      .expect(({ body }) => expect(body.slug).toBe(twin.slug));
  });

  it('moves the repository to a new slug when renamed', async () => {
    const { body } = await update({ name: 'Renamed' }).expect(200);
    expect(body.slug).toBe('renamed');

    await api().get(at()).set('cookie', owner.cookie).expect(404);
    repo = body.slug;
    await api().get(at()).set('cookie', owner.cookie).expect(200);
  });

  it('deletes the repository and everything it stored', async () => {
    const id = await repositoryId();
    expect((await storedKeys(id)).length).toBeGreaterThan(1);
    expect(existsSync(cacheOf(id))).toBe(true);

    await api().delete(at()).set('cookie', owner.cookie).expect(204);

    await api().get(at()).set('cookie', owner.cookie).expect(404);
    // Only the tombstone is left, and it holds no refs and no objects.
    expect(await storedKeys(id)).toEqual([`repos/${id}/index`]);
    expect(existsSync(cacheOf(id))).toBe(false);
  });

  it('turns away a push once the delete has begun, and finishes on retry', async () => {
    const created = await api()
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: 'racing', visibility: 'public' })
      .expect(201);
    repo = created.body.slug;
    await remote(work, 'push', '-q', remoteUrl(), 'main');
    const id = await repositoryId();
    const before = await storedKeys(id);

    // A delete that failed after its first step.
    await app.get(WalStoreService).tombstone(id);

    commit('too late');
    await expect(
      remote(work, 'push', '-q', remoteUrl(), 'main'),
    ).rejects.toThrow();
    expect(await storedKeys(id)).toEqual(before);

    await api().delete(at()).set('cookie', owner.cookie).expect(204);
    expect(await storedKeys(id)).toEqual([`repos/${id}/index`]);
  });
});
