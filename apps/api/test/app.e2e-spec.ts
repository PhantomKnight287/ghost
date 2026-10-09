import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { hasBackends, startApp } from './harness.js';

describe.skipIf(!hasBackends)('AppController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await startApp());
  });

  afterAll(async () => {
    await app?.close();
  });

  it('answers health checks at /api without credentials', () => {
    return request(app.getHttpServer())
      .get('/api')
      .expect(200)
      .expect('Hello World!');
  });
});
