import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { hasBackends, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)('pull refs past PULL_REF_MAX_BYTES', () => {
  let app: INestApplication;
  let origin: string;
  let owner: { cookie: string; key: string };
  let work: string;
  const username = `pulllimit${Date.now()}`;
  let repo: string;

  const api = () => request(app.getHttpServer());
  const remote = () =>
    `${origin.replace('://', `://${username}:${owner.key}@`)}/${username}/${repo}.git`;
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

  beforeAll(async () => {
    ({ app, origin } = await startApp({ PULL_REF_MAX_BYTES: '1' }));
    owner = await signUp(app, username);
    repo = (
      await api()
        .post('/api/repositories')
        .set('cookie', owner.cookie)
        .send({ name: 'limited', visibility: 'public' })
        .expect(201)
    ).body.slug;

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-pull-limit-'));
    git('init', '-q', '-b', 'main');
    git('commit', '-q', '--allow-empty', '-m', 'first');
    git('checkout', '-q', '-b', 'feature');
    writeFileSync(
      path.join(work, 'feature.txt'),
      'too big for a 1 byte limit\n',
    );
    git('add', '.');
    git('commit', '-q', '-m', 'feature');
    await run('push', '-q', remote(), 'main', 'feature');
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('leaves the refs unwritten and says why on the request', async () => {
    await api()
      .post(`/api/repositories/${username}/${repo}/pulls`)
      .set('cookie', owner.cookie)
      .send({ title: 'feature', base: 'main', head: 'feature' })
      .expect(201);

    await vi.waitFor(
      async () => {
        const { body } = await api()
          .get(`/api/repositories/${username}/${repo}/pulls/1`)
          .expect(200);
        expect(body.pullRefsBlocked).toMatch(/past the 1 B one update may add/);
      },
      { timeout: 15_000, interval: 200 },
    );
    const { stdout } = await run('ls-remote', remote(), 'refs/pull/*');
    expect(stdout).toBe('');
  });
});
