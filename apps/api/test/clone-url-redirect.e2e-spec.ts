import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, startApp } from './harness.js';

describe.skipIf(!hasBackends)('a clone URL opened in a browser', () => {
  let app: INestApplication;
  const web = 'https://web.example';

  beforeAll(async () => {
    ({ app } = await startApp({ WEB_APP_URL: web }));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it.each(['/ghost/ghost', '/ghost/ghost.git'])(
    'sends %s to the repository page',
    async (path) => {
      await request(app.getHttpServer())
        .get(path)
        .expect(302)
        .expect('location', `${web}/ghost/ghost`);
    },
  );

  it('leaves an API resource of the same shape to its own handler', async () => {
    const response = await request(app.getHttpServer()).get('/api/ssh-keys');

    expect(response.status).not.toBe(302);
  });

  it('leaves the git transport alone', async () => {
    const response = await request(app.getHttpServer()).get(
      '/ghost/missing/info/refs?service=git-upload-pack',
    );

    expect(response.status).not.toBe(302);
  });
});
