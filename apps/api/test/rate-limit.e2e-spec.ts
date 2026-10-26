import type { INestApplication } from '@nestjs/common';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { apiKey, hasBackends, REDIS_URL, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)('Rate limits on the API', () => {
  let app: INestApplication;
  let redis: Redis;
  let accounts = 0;

  /** A fresh account, so each test starts with the whole budget. */
  const account = async () => {
    const username = `rl${Date.now()}x${accounts++}`;
    return { username, ...(await signUp(app, username)) };
  };
  const http = () => request(app.getHttpServer());
  const remaining = (response: request.Response) =>
    response.headers['x-ratelimit-remaining'];

  beforeAll(async () => {
    ({ app } = await startApp({
      RATE_LIMIT_PER_MINUTE: '5',
      RATE_LIMIT_ANONYMOUS_PER_MINUTE: '3',
      RATE_LIMIT_SEARCH_PER_MINUTE: '2',
    }));
    redis = new Redis(REDIS_URL!);
  });

  afterAll(async () => {
    await redis?.quit();
    await app?.close();
  });

  it("reports the core budget on a 200 from Ghost's API", async () => {
    const { key } = await account();
    const response = await http()
      .get('/api/notifications')
      .set('authorization', `Bearer ${key}`)
      .expect(200);
    expect(response.headers['x-ratelimit-limit']).toBe('5');
    expect(response.headers['x-ratelimit-remaining']).toBe('4');
    expect(response.headers['x-ratelimit-used']).toBe('1');
    expect(response.headers['x-ratelimit-resource']).toBe('core');
    const reset = Number(response.headers['x-ratelimit-reset']);
    const now = Math.floor(Date.now() / 1000);
    expect(reset).toBeGreaterThanOrEqual(now);
    expect(reset).toBeLessThanOrEqual(now + 61);
  });

  it('shares one budget across tokens, the session and both APIs', async () => {
    const { key, cookie, userId } = await account();
    const second = await apiKey(app, userId);
    const first = await http()
      .get('/api/notifications')
      .set('authorization', `Bearer ${key}`)
      .expect(200);
    const github = await http()
      .get('/api/v3/user')
      .set('authorization', `Bearer ${second}`)
      .expect(200);
    const session = await http()
      .get('/api/notifications')
      .set('cookie', cookie)
      .expect(200);
    expect([first, github, session].map(remaining)).toEqual(['4', '3', '2']);
  });

  it('counts a token on a sign-in-optional route by its account, not its IP', async () => {
    const { username, key, cookie } = await account();
    await http()
      .post('/api/repositories')
      .set('cookie', cookie)
      .send({ name: 'open', visibility: 'public' })
      .expect(201);
    const response = await http()
      .get(`/api/repositories/${username}/open`)
      .set('authorization', `Bearer ${key}`)
      .expect(200);
    expect(response.headers['x-ratelimit-limit']).toBe('5');
  });

  it("refuses Ghost's API over budget with Retry-After", async () => {
    const { key } = await account();
    for (let i = 0; i < 5; i++)
      await http()
        .get('/api/notifications')
        .set('authorization', `Bearer ${key}`)
        .expect(200);
    const response = await http()
      .get('/api/notifications')
      .set('authorization', `Bearer ${key}`)
      .expect(429);
    const retryAfter = Number(response.headers['retry-after']);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(response.headers['x-ratelimit-remaining']).toBe('0');
    expect(response.body.message).toBe('API rate limit exceeded');
  });

  it("refuses GitHub REST over budget in GitHub's shape", async () => {
    const { key } = await account();
    for (let i = 0; i < 5; i++)
      await http()
        .get('/api/v3/user')
        .set('authorization', `Bearer ${key}`)
        .expect(200);
    const response = await http()
      .get('/api/v3/user')
      .set('authorization', `Bearer ${key}`)
      .expect(429);
    expect(response.body).toEqual({
      message: 'API rate limit exceeded',
      documentation_url:
        'https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api',
    });
    expect(Number(response.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(response.headers['x-ratelimit-remaining']).toBe('0');
    expect(response.headers['x-ratelimit-resource']).toBe('core');
  });

  it('refuses GraphQL over budget with HTTP 429, not a GraphQL error', async () => {
    const { key } = await account();
    const graphql = (query: string) =>
      http()
        .post('/api/graphql')
        .set('authorization', `Bearer ${key}`)
        .send({ query });
    const first = await graphql(
      '{ viewer { login } rateLimitProbe: viewer { id } }',
    ).expect(200);
    expect(first.body.errors).toBeUndefined();
    expect(remaining(first)).toBe('4');
    for (let i = 0; i < 4; i++)
      await graphql('{ viewer { login } }').expect(200);
    const refused = await graphql('{ viewer { login } }').expect(429);
    expect(refused.headers['x-ratelimit-remaining']).toBe('0');
    expect(Number(refused.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  });

  it('counts anonymous callers per IP', async () => {
    const { username } = await account();
    const response = await http().get(`/api/v3/users/${username}`);
    expect(response.headers['x-ratelimit-limit']).toBe('3');
    expect(response.headers['x-ratelimit-resource']).toBe('core');
  });

  it('does not count a refused request', async () => {
    const { key, userId } = await account();
    for (let i = 0; i < 5; i++)
      await http()
        .get('/api/notifications')
        .set('authorization', `Bearer ${key}`)
        .expect(200);
    for (let i = 0; i < 2; i++)
      await http()
        .get('/api/notifications')
        .set('authorization', `Bearer ${key}`)
        .expect(429);
    expect(await redis.get(`ratelimit:core:${userId}`)).toBe('5');
  });

  it('reports the tighter search budget on expensive reads', async () => {
    const { username, key } = await account();
    const files = () =>
      http()
        .get(`/api/v3/repos/${username}/nothing/pulls/1/files`)
        .set('authorization', `Bearer ${key}`);
    const first = await files();
    expect(first.headers['x-ratelimit-resource']).toBe('search');
    expect(remaining(first)).toBe('1');
    const second = await files();
    expect(second.headers['x-ratelimit-resource']).toBe('search');
    expect(remaining(second)).toBe('0');
    const third = await files().expect(429);
    expect(third.headers['x-ratelimit-resource']).toBe('search');
  });

  it('does not charge core for a read the search budget refuses', async () => {
    const { username, key, userId } = await account();
    const files = () =>
      http()
        .get(`/api/v3/repos/${username}/nothing/pulls/1/files`)
        .set('authorization', `Bearer ${key}`);
    await files();
    await files();
    await files().expect(429);
    expect(await redis.get(`ratelimit:core:${userId}`)).toBe('2');
  });

  it('counts a pull request as a search only when asked for as a diff', async () => {
    const { username, key } = await account();
    const pull = (accept: string) =>
      http()
        .get(`/api/v3/repos/${username}/nothing/pulls/1`)
        .set('authorization', `Bearer ${key}`)
        .set('accept', accept);
    const json = await pull('application/vnd.github+json');
    expect(json.headers['x-ratelimit-resource']).toBe('core');
    const diff = await pull('application/vnd.github.diff');
    expect(diff.headers['x-ratelimit-resource']).toBe('search');
  });

  it('leaves avatars and attachments, which pages load as images, uncounted', async () => {
    for (let i = 0; i < 5; i++)
      for (const path of [
        '/api/users/avatars/nobody/missing.png',
        '/api/attachments/missing',
      ]) {
        const response = await http().get(path);
        expect(response.status).not.toBe(429);
        expect(response.headers['x-ratelimit-limit']).toBeUndefined();
      }
  });

  it('leaves health checks and internal routes uncounted', async () => {
    for (let i = 0; i < 20; i++) {
      const response = await http().get('/api').expect(200);
      expect(response.headers['x-ratelimit-limit']).toBeUndefined();
    }
  });

  it('leaves a wrong token as 401 Bad credentials', async () => {
    const response = await http()
      .get('/api/v3/user')
      .set('authorization', 'Bearer ghost_pat_nope')
      .expect(401);
    expect(response.body.message).toBe('Bad credentials');
    expect(response.headers['retry-after']).toBeUndefined();
  });
});

describe.skipIf(!hasBackends)('Rate limits on the web app', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app } = await startApp({
      WEB_API_SECRET: 'web-secret',
      RATE_LIMIT_WEB_PER_MINUTE: '7',
      RATE_LIMIT_PER_MINUTE: '5',
    }));
  });

  afterAll(async () => {
    await app?.close();
  });

  it('counts the web app against its own budget', async () => {
    const { cookie } = await signUp(app, `rlweb${Date.now()}`);
    const web = await http()
      .get('/api/notifications')
      .set('cookie', cookie)
      .set('x-ghost-web-secret', 'web-secret')
      .expect(200);
    expect(web.headers['x-ratelimit-limit']).toBe('7');
    expect(web.headers['x-ratelimit-resource']).toBe('web');
    const direct = await http()
      .get('/api/notifications')
      .set('cookie', cookie)
      .expect(200);
    expect(direct.headers['x-ratelimit-limit']).toBe('5');
    expect(direct.headers['x-ratelimit-remaining']).toBe('4');
  });

  it('counts a wrong secret against core', async () => {
    const { cookie } = await signUp(app, `rlwrong${Date.now()}`);
    const response = await http()
      .get('/api/notifications')
      .set('cookie', cookie)
      .set('x-ghost-web-secret', 'wrong')
      .expect(200);
    expect(response.headers['x-ratelimit-resource']).toBe('core');
  });

  it('counts anonymous web traffic by the forwarded IP', async () => {
    vi.stubEnv('RAILWAY_SERVICE_ID', 'svc');
    try {
      const username = `rlanon${Date.now()}`;
      await signUp(app, username);
      for (const ip of ['198.51.100.7', '198.51.100.8']) {
        const response = await http()
          .get(`/api/v3/users/${username}`)
          .set('x-ghost-web-secret', 'web-secret')
          .set('x-real-ip', ip)
          .expect(200);
        expect(response.headers['x-ratelimit-resource']).toBe('web');
        expect(response.headers['x-ratelimit-used']).toBe('1');
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
