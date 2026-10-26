import { type Database, schema } from '@ghost/db';
import type { INestApplication } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import type { Auth } from '../src/lib/auth.js';
import { hasBackends, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)('A key over its rate limit', () => {
  let app: INestApplication;
  let owner: { cookie: string; key: string; userId: string };
  const username = `ratelimit${Date.now()}`;

  /** A fresh key that has already spent its whole budget for the current window. */
  const spentKey = async () => {
    const { id, key } = await app
      .get<AuthService<Auth>>(AuthService)
      .api.createApiKey({ body: { userId: owner.userId } });
    await app
      .get<Database>(DATABASE)
      .update(schema.apikey)
      .set({ requestCount: 120, lastRequest: new Date() })
      .where(eq(schema.apikey.id, id));
    return key;
  };

  const expectRateLimitHeaders = (headers: Record<string, string>) => {
    const retryAfter = Number(headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(headers['x-ratelimit-limit']).toBe('120');
    expect(headers['x-ratelimit-remaining']).toBe('0');
    expect(headers['x-ratelimit-used']).toBe('120');
    expect(headers['x-ratelimit-resource']).toBe('core');
    const reset = Number(headers['x-ratelimit-reset']);
    const now = Math.floor(Date.now() / 1000);
    expect(reset).toBeGreaterThan(now);
    expect(reset).toBeLessThanOrEqual(now + 61);
  };

  beforeAll(async () => {
    ({ app } = await startApp());
    owner = await signUp(app, username);
    await request(app.getHttpServer())
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: 'repo', visibility: 'public' })
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('gets 429 with rate-limit headers from the GitHub-compatible API, not Bad credentials', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v3/user')
      .set('authorization', `Bearer ${await spentKey()}`)
      .expect(429);
    expectRateLimitHeaders(response.headers);
    expect(response.body).toEqual({
      message: 'API rate limit exceeded',
      documentation_url:
        'https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api',
    });
  });

  it("gets 429 with rate-limit headers from Ghost's own API", async () => {
    const response = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('authorization', `Bearer ${await spentKey()}`)
      .expect(429);
    expectRateLimitHeaders(response.headers);
    expect(response.body.message).toBe('API rate limit exceeded');
  });

  it('gets 429 with rate-limit headers over git, not a fresh password prompt', async () => {
    const basic = Buffer.from(`x:${await spentKey()}`).toString('base64');
    const response = await request(app.getHttpServer())
      .get(`/${username}/repo.git/info/refs?service=git-upload-pack`)
      .set('authorization', `Basic ${basic}`)
      .expect(429);
    expectRateLimitHeaders(response.headers);
    expect(response.headers['www-authenticate']).toBeUndefined();
  });

  it('leaves a wrong token as 401 Bad credentials, without rate-limit headers', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v3/user')
      .set('authorization', 'Bearer ghost_pat_nope')
      .expect(401);
    expect(response.body.message).toBe('Bad credentials');
    expect(response.headers['retry-after']).toBeUndefined();
  });

  it('lets a key with budget left through', async () => {
    await request(app.getHttpServer())
      .get('/api/v3/user')
      .set('authorization', `Bearer ${owner.key}`)
      .expect(200);
  });
});
