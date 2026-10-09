import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, scopedKey, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)('GitHub scopes', () => {
  let app: INestApplication;
  let owner: { cookie: string; key: string; userId: string };
  const username = `ghscope${Date.now()}`;

  beforeAll(async () => {
    ({ app } = await startApp());
    owner = await signUp(app, username);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('reports a scoped key its own scopes, and a Ghost key every scope', async () => {
    const key = await scopedKey(app, owner.userId, ['read:org', 'gist']);
    const scoped = await request(app.getHttpServer()).get('/api/v3/').set('authorization', `token ${key}`).expect(200);
    expect(scoped.headers['x-oauth-scopes']).toBe('read:org, gist');
    const full = await request(app.getHttpServer()).get('/api/v3/').set('authorization', `token ${owner.key}`).expect(200);
    expect(full.headers['x-oauth-scopes']).toContain('repo');
  });

  it("never lets an API key into Ghost's own API", async () => {
    const key = await scopedKey(app, owner.userId, ['repo']);
    await request(app.getHttpServer()).get('/api/notifications').set('authorization', `Bearer ${key}`).expect(401);
    await request(app.getHttpServer()).get('/api/notifications').set('x-api-key', key).expect(401);
  });
});
