import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, scopedKey, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)('GitHub commit statuses', () => {
  let app: INestApplication;
  let work: string;
  let owner: { cookie: string; key: string; userId: string };
  let main: string;
  let feature: string;
  const username = `ghstatuses${Date.now()}`;
  const repo = `/repos/${username}/ci`;
  const http = () => request(app.getHttpServer());
  const get = (path: string) =>
    http().get(`/api/v3${path}`).set('authorization', `token ${owner.key}`);
  const post = (sha: string, body: object) =>
    http()
      .post(`/api/v3${repo}/statuses/${sha}`)
      .set('authorization', `token ${owner.key}`)
      .send(body);

  beforeAll(async () => {
    let origin: string;
    ({ app, origin } = await startApp());
    owner = await signUp(app, username);
    await http()
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: 'ci', visibility: 'public' })
      .expect(201);

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-ghstatuses-'));
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
        { cwd: work, encoding: 'utf8' },
      ).trim();
    git('init', '-q', '-b', 'main');
    writeFileSync(path.join(work, 'a.txt'), 'one\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    main = git('rev-parse', 'HEAD');
    git('checkout', '-q', '-b', 'feat/x');
    writeFileSync(path.join(work, 'a.txt'), 'two\n');
    git('commit', '-q', '-am', 'second');
    feature = git('rev-parse', 'HEAD');
    // The server runs in this process, so the push must not block the event loop.
    await promisify(execFile)(
      'git',
      [
        'push',
        '-q',
        `${origin.replace('://', `://${username}:${owner.key}@`)}/${username}/ci.git`,
        'main',
        'feat/x',
      ],
      { cwd: work, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('creates a status in GitHub shape, in the default context when none is given', async () => {
    const { body, headers } = await post(main, {
      state: 'success',
      target_url: 'https://ci.example.com/1',
      description: 'Build passed',
    }).expect(201);
    expect(body).toMatchObject({
      id: expect.any(Number),
      node_id: expect.stringMatching(/^SC_/),
      state: 'success',
      context: 'default',
      description: 'Build passed',
      target_url: 'https://ci.example.com/1',
      creator: expect.objectContaining({ login: username }),
      avatar_url: expect.any(String),
    });
    expect(body.url).toMatch(
      new RegExp(`/api/v3/repos/${username}/ci/statuses/${main}$`),
    );
    expect(body.updated_at).toBe(body.created_at);
    expect(headers.location).toBe(body.url);
  });

  it('refuses a state GitHub does not know and an overlong description with 422', async () => {
    const state = await post(main, { state: 'done' }).expect(422);
    expect(state.body).toMatchObject({
      message: 'Validation Failed',
      errors: [expect.objectContaining({ field: 'state' })],
    });
    const description = await post(main, {
      state: 'success',
      description: 'x'.repeat(141),
    }).expect(422);
    expect(description.body.errors).toEqual([
      expect.objectContaining({ field: 'description' }),
    ]);
  });

  it('refuses an empty context and one past 255 characters with 422', async () => {
    for (const context of ['', 'x'.repeat(256)]) {
      const { body } = await post(main, { state: 'success', context }).expect(
        422,
      );
      expect(body).toMatchObject({
        message: 'Validation Failed',
        errors: [expect.objectContaining({ field: 'context' })],
      });
    }
  });

  it('refuses a write from an anonymous caller and from a key without a repo scope', async () => {
    await http()
      .post(`/api/v3${repo}/statuses/${main}`)
      .send({ state: 'success' })
      .expect(401);
    const key = await scopedKey(app, owner.userId, ['read:user']);
    await http()
      .post(`/api/v3${repo}/statuses/${main}`)
      .set('authorization', `token ${key}`)
      .send({ state: 'success' })
      .expect(403);
  });

  it('answers the combined status of a public repository to an anonymous caller', async () => {
    await http().get(`/api/v3${repo}/commits/main/status`).expect(200);
  });

  it('refuses a sha that is not a commit in the repository with 422', async () => {
    const { body } = await post('0'.repeat(40), { state: 'success' }).expect(
      422,
    );
    expect(body).toMatchObject({
      message: 'Validation Failed',
      errors: [{ resource: 'Status', field: 'sha', code: 'invalid' }],
    });
  });

  it('lists a commit’s statuses newest first, paged with a Link header', async () => {
    await post(feature, { state: 'pending', context: 'ci/build' }).expect(201);
    await post(feature, { state: 'failure', context: 'ci/build' }).expect(201);

    const all = await get(`${repo}/commits/${feature}/statuses`).expect(200);
    expect(all.body.map((status: { state: string }) => status.state)).toEqual([
      'failure',
      'pending',
    ]);
    expect(all.headers.link).toBeUndefined();

    const first = await get(
      `${repo}/commits/${feature}/statuses?per_page=1`,
    ).expect(200);
    expect(first.body).toHaveLength(1);
    expect(first.body[0].state).toBe('failure');
    expect(first.headers.link).toContain('rel="next"');
  });

  it('answers the combined status of a branch', async () => {
    const { body } = await get(`${repo}/commits/main/status`).expect(200);
    expect(body).toMatchObject({
      state: 'success',
      sha: main,
      total_count: 1,
      statuses: [expect.objectContaining({ context: 'default' })],
      repository: expect.objectContaining({
        full_name: `${username}/ci`,
      }),
    });
    expect(body.url).toMatch(
      new RegExp(`/api/v3/repos/${username}/ci/commits/${main}/status$`),
    );
    expect(body.commit_url).toMatch(
      new RegExp(`/api/v3/repos/${username}/ci/commits/${main}$`),
    );
  });

  it('resolves a branch whose name holds a slash', async () => {
    const { body } = await get(`${repo}/commits/feat/x/status`).expect(200);
    expect(body).toMatchObject({
      state: 'failure',
      sha: feature,
      total_count: 1,
    });
  });

  it('answers a ref that names no commit with 404', async () => {
    const { body } = await get(`${repo}/commits/nope/status`).expect(404);
    expect(body.message).toBe('No commit found for SHA: nope');
    await get(`${repo}/commits/nope/statuses`).expect(404);
  });
});
