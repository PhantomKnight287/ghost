import { randomUUID } from 'node:crypto';

import { type Database, schema } from '@ghost/db';
import type { INestApplication } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import type { Auth } from '../src/lib/auth.js';
import { apiKey, hasBackends, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)('Ghost App identity', () => {
  let app: INestApplication;
  let db: Database;
  let owner: { cookie: string; key: string; userId: string };
  const stamp = Date.now();
  const ownerName = `idowner${stamp}`;
  const api = () => request(app.getHttpServer());
  const auth = () => app.get<AuthService<Auth>>(AuthService);

  const insertBot = async (slug: string) => {
    const id = randomUUID();
    await db.insert(schema.user).values({
      id,
      kind: 'bot',
      name: slug,
      username: `${slug}[bot]`,
      email: `${slug}[bot]@bots.invalid`,
    });
    return id;
  };

  beforeAll(async () => {
    ({ app } = await startApp());
    db = app.get<Database>(DATABASE);
    owner = await signUp(app, ownerName);
    await api()
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: 'secret', visibility: 'private' })
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('refuses the username apps, which the public app pages live under', async () => {
    await expect(signUp(app, 'apps')).rejects.toThrow('That name is reserved');
  });

  it('defaults a person who signs up to kind user', async () => {
    const [row] = await db
      .select({ kind: schema.user.kind })
      .from(schema.user)
      .where(eq(schema.user.id, owner.userId));
    expect(row).toEqual({ kind: 'user' });
  });

  it('never opens a session for a bot', async () => {
    const botId = await insertBot(`sessionbot${stamp}`);
    const { internalAdapter } = await auth().instance.$context;
    await expect(internalAdapter.createSession(botId)).rejects.toThrow();
    const sessions = await db
      .select({ id: schema.session.id })
      .from(schema.session)
      .where(eq(schema.session.userId, botId));
    expect(sessions).toEqual([]);
  });

  it('rejects an API key a bot owns, on REST and on git', async () => {
    const botId = await insertBot(`keybot${stamp}`);
    const key = await apiKey(app, botId);

    await api()
      .get('/api/v3/user')
      .set('authorization', `token ${key}`)
      .expect(401);
    await api()
      .get(`/${ownerName}/secret.git/info/refs?service=git-upload-pack`)
      .set(
        'authorization',
        `Basic ${Buffer.from(`x-access-token:${key}`).toString('base64')}`,
      )
      .expect(401);
  });

  it('refuses an app without an owner unless the app is deleted', async () => {
    const botId = await insertBot(`ownerless${stamp}`);
    const row = {
      id: randomUUID(),
      slug: `ownerless${stamp}`,
      name: 'Ownerless',
      homepageUrl: 'https://ownerless.example',
      permissions: {},
      events: [],
      botUserId: botId,
    };

    await expect(db.insert(schema.app).values(row)).rejects.toThrow();
    await db.insert(schema.app).values({ ...row, deletedAt: new Date() });
    const [stored] = await db
      .select({ numericId: schema.app.numericId })
      .from(schema.app)
      .where(eq(schema.app.id, row.id));
    expect(stored?.numericId).toEqual(expect.any(Number));
  });

  it('keeps both owner columns from being set at once', async () => {
    const botId = await insertBot(`twoowners${stamp}`);
    const organizationId = (await auth().api.createOrganization({
      body: { name: `Two ${stamp}`, slug: `twoowners${stamp}` },
      headers: new Headers({ cookie: owner.cookie }),
    }))!.id;

    await expect(
      db.insert(schema.app).values({
        id: randomUUID(),
        slug: `twoowners${stamp}`,
        name: 'Two owners',
        homepageUrl: 'https://two.example',
        permissions: {},
        events: [],
        botUserId: botId,
        ownerUserId: owner.userId,
        ownerOrganizationId: organizationId,
      }),
    ).rejects.toThrow();
  });
});
