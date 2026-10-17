import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, scopedKey, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)('GitHub user attachments', () => {
  let app: INestApplication;
  let owner: { cookie: string; key: string; userId: string };
  let reader: { cookie: string; key: string; userId: string };
  let publicId: number;
  let privateId: number;
  const username = `ghattach${Date.now()}`;
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const http = () => request(app.getHttpServer());
  const upload = (
    query: Record<string, string | number>,
    token: string | null = owner.key,
    bytes = png,
  ) => {
    const call = http()
      .post(
        `/api/uploads/user-attachments/assets?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))}`,
      )
      .set('content-type', 'application/octet-stream')
      .send(bytes);
    return token ? call.set('authorization', `token ${token}`) : call;
  };

  beforeAll(async () => {
    ({ app } = await startApp());
    owner = await signUp(app, username);
    reader = await signUp(app, `${username}r`);
    for (const [name, visibility] of [
      ['notes', 'public'],
      ['secret', 'private'],
    ])
      await http()
        .post('/api/repositories')
        .set('cookie', owner.cookie)
        .send({ name, visibility })
        .expect(201);
    const id = async (name: string) =>
      (
        await http()
          .get(`/api/v3/repos/${username}/${name}`)
          .set('authorization', `token ${owner.key}`)
          .expect(200)
      ).body.id as number;
    publicId = await id('notes');
    privateId = await id('secret');
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('stores the file and answers the attachment URL the repository serves it at', async () => {
    const { body } = await upload({
      name: 'shot.png',
      content_type: 'image/png',
      repository_id: publicId,
    }).expect(201);
    expect(body).toEqual({
      id: expect.any(String),
      name: 'shot.png',
      size: png.length,
      content_type: 'image/png',
      url: expect.stringMatching(new RegExp(`/api/attachments/${body.id}$`)),
    });
    const served = await http()
      .get(new URL(body.url).pathname)
      .buffer(true)
      .expect(200);
    expect(Buffer.from(served.body)).toEqual(png);
  });

  it('uploads to a private repository with a repo-scoped key', async () => {
    await upload({ name: 'shot.png', repository_id: privateId }).expect(201);
  });

  it('refuses an anonymous upload with 401', async () => {
    await upload({ name: 'shot.png', repository_id: publicId }, null).expect(
      401,
    );
  });

  it('answers 404 to a caller who cannot write, and for a repository that does not exist', async () => {
    await upload(
      { name: 'shot.png', repository_id: publicId },
      reader.key,
    ).expect(404);
    await upload(
      { name: 'shot.png', repository_id: privateId },
      reader.key,
    ).expect(404);
    await upload({ name: 'shot.png', repository_id: 999_999_999 }).expect(404);
  });

  it('needs a write scope: public_repo reaches a public repository but not a private one', async () => {
    const readOnly = await scopedKey(app, owner.userId, ['read:user']);
    await upload(
      { name: 'shot.png', repository_id: publicId },
      readOnly,
    ).expect(403);
    const publicRepo = await scopedKey(app, owner.userId, ['public_repo']);
    await upload(
      { name: 'shot.png', repository_id: publicId },
      publicRepo,
    ).expect(201);
    await upload(
      { name: 'shot.png', repository_id: privateId },
      publicRepo,
    ).expect(404);
  });

  it('refuses a file type attachments do not take, and a query without a name or repository', async () => {
    await upload({ name: 'run.exe', repository_id: publicId }).expect(415);
    await upload({ repository_id: publicId }).expect(422);
    await upload({ name: 'shot.png' }).expect(422);
  });
});
