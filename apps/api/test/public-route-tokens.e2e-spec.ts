import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)('A token on a public route', () => {
  let app: INestApplication;
  let owner: { cookie: string; key: string; userId: string };
  const username = `publictoken${Date.now()}`;

  beforeAll(async () => {
    ({ app } = await startApp());
    owner = await signUp(app, username);
    for (const [name, visibility] of [
      ['open', 'public'],
      ['hidden', 'private'],
    ])
      await request(app.getHttpServer())
        .post('/api/repositories')
        .set('cookie', owner.cookie)
        .send({ name, visibility })
        .expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('sees what its owner sees', async () => {
    await request(app.getHttpServer())
      .get(`/api/repositories/${username}/hidden`)
      .set('authorization', `Bearer ${owner.key}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/repositories/${username}/hidden`)
      .expect(401);
  });

  it('is refused with 401 when bad', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/repositories/${username}/open`)
      .set('authorization', 'Bearer ghost_pat_nope')
      .expect(401);
    expect(response.body.message).toBe('Bad credentials');
  });
});
