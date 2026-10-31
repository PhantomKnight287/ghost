import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)("a pull request's commit by sha", () => {
  let app: INestApplication;
  let work: string;
  let main: string;
  const shas: string[] = [];
  const owner = `prcommit${Date.now()}`;
  const repos = `/api/repositories/${owner}/app`;
  const api = () => request(app.getHttpServer());
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
      { cwd: work, encoding: 'utf8' },
    ).trim();
  const locate = (sha: string) => api().get(`${repos}/pulls/1/commits/${sha}`);

  beforeAll(async () => {
    let origin: string;
    ({ app, origin } = await startApp());
    const user = await signUp(app, owner);
    await api()
      .post('/api/repositories')
      .set('cookie', user.cookie)
      .send({ name: 'app', visibility: 'public' })
      .expect(201);

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-prcommit-'));
    git('init', '-q', '-b', 'main');
    git('commit', '-q', '--allow-empty', '-m', 'base');
    main = git('rev-parse', 'HEAD');
    git('checkout', '-q', '-b', 'feature');
    // More than one page of the commit list, so a sha past the first page is reached.
    for (let i = 0; i < 105; i++) {
      git('commit', '-q', '--allow-empty', '-m', `change ${i}`);
      shas.push(git('rev-parse', 'HEAD'));
    }
    // The server runs in this process, so the push must not block the event loop.
    await promisify(execFile)(
      'git',
      [
        'push',
        '-q',
        `${origin.replace('://', `://${owner}:${user.key}@`)}/${owner}/app.git`,
        'main',
        'feature',
      ],
      { cwd: work, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
    await api()
      .post(`${repos}/pulls`)
      .set('cookie', user.cookie)
      .send({ title: 'feature', base: 'main', head: 'feature' })
      .expect(201);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('places the oldest commit first, with only a newer neighbour', async () => {
    const { body } = await locate(shas[0]).expect(200);
    expect(body).toEqual({
      position: 1,
      total: 105,
      previousSha: null,
      nextSha: shas[1],
    });
  });

  it('places the head last, with only an older neighbour', async () => {
    const { body } = await locate(shas[104]).expect(200);
    expect(body).toEqual({
      position: 105,
      total: 105,
      previousSha: shas[103],
      nextSha: null,
    });
  });

  it('finds a commit past the first hundred of the newest-first list', async () => {
    const { body } = await locate(shas[2]).expect(200);
    expect(body).toMatchObject({
      position: 3,
      previousSha: shas[1],
      nextSha: shas[3],
    });
  });

  it('answers 404 for the base commit and for a sha the repository does not have', async () => {
    await locate(main).expect(404);
    await locate('0'.repeat(40)).expect(404);
    await locate('not-a-sha').expect(404);
  });
});
