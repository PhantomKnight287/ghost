import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Database, schema } from '@ghost/db';

import { DATABASE } from '../src/database/database.module.js';
import { hasBackends, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)('storage limits', () => {
  let app: INestApplication;
  let origin: string;
  let owner: Awaited<ReturnType<typeof signUp>>;
  let forker: Awaited<ReturnType<typeof signUp>>;
  let work: string;
  const stamp = Date.now();
  const ownerName = `limitowner${stamp}`;
  const forkerName = `limitforker${stamp}`;
  let repo: string;

  const api = () => request(app.getHttpServer());
  const remote = (username: string, key: string, slug: string) =>
    `${origin.replace('://', `://${username}:${key}@`)}/${username}/${slug}.git`;
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
      { cwd: work, encoding: 'utf8' },
    ).trim();
  // The server runs in this process, so anything that talks to it must not block the event loop.
  const run = (...args: string[]) =>
    promisify(execFile)('git', args, {
      cwd: work,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  const usage = (cookie: string, account: string) =>
    api()
      .get(`/api/storage/${account}`)
      .set('cookie', cookie)
      .expect(200)
      .then((response) => response.body);
  const commitRandom = (name: string, bytes: number) => {
    // Random bytes do not compress, so the pack is about as large as the file.
    writeFileSync(path.join(work, name), randomBytes(bytes));
    git('add', '.');
    git('commit', '-q', '-m', name);
  };

  beforeAll(async () => {
    ({ app, origin } = await startApp({
      STORAGE_QUOTA_BYTES: '64kb',
      FORK_STORAGE_QUOTA_BYTES: '',
    }));
    owner = await signUp(app, ownerName);
    forker = await signUp(app, forkerName);

    repo = (
      await api()
        .post('/api/repositories')
        .set('cookie', owner.cookie)
        .send({ name: 'limited', visibility: 'public' })
        .expect(201)
    ).body.slug;
    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-storage-'));
    git('init', '-q', '-b', 'main');
    commitRandom('small.bin', 16 * 1024);
    await run('push', '-q', remote(ownerName, owner.key, repo), 'main');
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('bills a push against the repository quota', async () => {
    const { usedBytes, quotaBytes } = await usage(owner.cookie, ownerName);
    expect(usedBytes).toBeGreaterThan(16 * 1024);
    expect(quotaBytes).toBe(64 * 1024);
  });

  it('refuses a push that would take the account past its quota, and bills nothing for it', async () => {
    const before = await usage(owner.cookie, ownerName);
    commitRandom('large.bin', 64 * 1024);

    await expect(
      run('push', '-q', remote(ownerName, owner.key, repo), 'main'),
    ).rejects.toThrow(
      /\[remote rejected\] main -> main \(Storage quota exceeded: /,
    );
    git('reset', '-q', '--hard', 'HEAD~1');
    expect((await usage(owner.cookie, ownerName)).usedBytes).toBe(
      before.usedBytes,
    );
  });

  it('lets an account past its quota still delete a branch', async () => {
    const target = remote(ownerName, owner.key, repo);
    await run('push', '-q', target, 'main:doomed');
    await app
      .get<Database>(DATABASE)
      .insert(schema.storageLimit)
      .values({ userId: owner.userId, repositoryBytes: 1 });

    await run('push', '-q', target, ':doomed');
  });

  it('bills a fork against the fork quota, which an account override can set', async () => {
    await app
      .get<Database>(DATABASE)
      .insert(schema.storageLimit)
      .values({ userId: forker.userId, forkBytes: 1024 });

    const { body } = await api()
      .post(`/api/repositories/${ownerName}/${repo}/fork`)
      .set('cookie', forker.cookie)
      .send({ name: 'fork', visibility: 'public' })
      .expect(413);
    expect(body.message).toMatch(/Storage quota exceeded/);

    await app
      .get<Database>(DATABASE)
      .update(schema.storageLimit)
      .set({ forkBytes: null });
    await api()
      .post(`/api/repositories/${ownerName}/${repo}/fork`)
      .set('cookie', forker.cookie)
      .send({ name: 'fork', visibility: 'public' })
      .expect(201);

    const { usedBytes, fork } = await usage(forker.cookie, forkerName);
    expect(usedBytes).toBe(0);
    expect(fork.usedBytes).toBeGreaterThan(16 * 1024);
    expect(fork.quotaBytes).toBeNull();
  });
});
