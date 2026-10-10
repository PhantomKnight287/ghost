import { type Database, schema } from '@ghost/db';
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import { hasBackends, scopedKey, signUp, startApp } from './harness.js';

const GH = '178c6fc778ccc68e1d6a';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

describe.skipIf(!hasBackends)('OAuth apps', () => {
  let app: INestApplication;
  let db: Database;
  let owner: { cookie: string; key: string; userId: string };
  let other: { cookie: string; key: string; userId: string };
  const stamp = Date.now();
  const api = () => request(app.getHttpServer());
  const create = (cookie: string, body: object = {}) => api().post('/api/oauth-apps').set('cookie', cookie).send({ name: 'Scoped Tool', homepageUrl: 'https://tool.example', callbackUrls: ['https://tool.example/callback'], ...body });

  beforeAll(async () => {
    ({ app } = await startApp());
    db = app.get<Database>(DATABASE);
    owner = await signUp(app, `oaapps${stamp}`);
    other = await signUp(app, `oaother${stamp}`);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('shows the client secret once, on create, and never on read', async () => {
    const created = await create(owner.cookie).expect(201);
    expect(created.body).toMatchObject({ name: 'Scoped Tool', homepageUrl: 'https://tool.example', callbackUrls: ['https://tool.example/callback'], deviceFlowEnabled: false });
    expect(created.body.clientId).toBeTruthy();
    expect(created.body.clientSecret).toEqual(expect.any(String));

    const one = await api().get(`/api/oauth-apps/${created.body.clientId}`).set('cookie', owner.cookie).expect(200);
    expect(one.body.clientSecret).toBeUndefined();
    expect(one.body).toMatchObject({ clientId: created.body.clientId, name: 'Scoped Tool' });
    const list = await api().get('/api/oauth-apps').set('cookie', owner.cookie).expect(200);
    expect(list.body.apps.map((each: { clientId: string }) => each.clientId)).toContain(created.body.clientId);
    expect(JSON.stringify(list.body)).not.toContain(created.body.clientSecret);

    const [row] = await db.select({ clientSecret: schema.oauthClient.clientSecret }).from(schema.oauthClient).where(eq(schema.oauthClient.clientId, created.body.clientId));
    expect(row?.clientSecret).toBeTruthy();
    expect(row?.clientSecret).not.toBe(created.body.clientSecret);
  });

  it('updates an app and turns its device flow on', async () => {
    const { body } = await create(owner.cookie).expect(201);
    const updated = await api().patch(`/api/oauth-apps/${body.clientId}`).set('cookie', owner.cookie).send({ name: 'Renamed', callbackUrls: ['http://localhost:4000/cb'], deviceFlowEnabled: true }).expect(200);
    expect(updated.body).toMatchObject({ name: 'Renamed', callbackUrls: ['http://localhost:4000/cb'], deviceFlowEnabled: true, homepageUrl: 'https://tool.example' });
    await api().post('/login/device/code').type('form').send({ client_id: body.clientId, scope: 'repo' }).expect(200);

    const enabled = await create(owner.cookie, { deviceFlowEnabled: true }).expect(201);
    expect(enabled.body.deviceFlowEnabled).toBe(true);
  });

  it('rotates the secret, replacing the stored one', async () => {
    const { body } = await create(owner.cookie).expect(201);
    const before = await db.select({ clientSecret: schema.oauthClient.clientSecret }).from(schema.oauthClient).where(eq(schema.oauthClient.clientId, body.clientId));
    const rotated = await api().post(`/api/oauth-apps/${body.clientId}/secret`).set('cookie', owner.cookie).expect(201);
    expect(rotated.body.clientSecret).toEqual(expect.any(String));
    expect(rotated.body.clientSecret).not.toBe(body.clientSecret);
    const after = await db.select({ clientSecret: schema.oauthClient.clientSecret }).from(schema.oauthClient).where(eq(schema.oauthClient.clientId, body.clientId));
    expect(after[0]?.clientSecret).not.toBe(before[0]?.clientSecret);
  });

  it("hides another user's app behind 404", async () => {
    const { body } = await create(owner.cookie).expect(201);
    await api().get(`/api/oauth-apps/${body.clientId}`).set('cookie', other.cookie).expect(404);
    await api().patch(`/api/oauth-apps/${body.clientId}`).set('cookie', other.cookie).send({ name: 'Mine now' }).expect(404);
    await api().post(`/api/oauth-apps/${body.clientId}/secret`).set('cookie', other.cookie).expect(404);
    await api().delete(`/api/oauth-apps/${body.clientId}`).set('cookie', other.cookie).expect(404);
    const list = await api().get('/api/oauth-apps').set('cookie', other.cookie).expect(200);
    expect(list.body.apps).toEqual([]);
  });

  it('refuses to change gh', async () => {
    await api().patch(`/api/oauth-apps/${GH}`).set('cookie', owner.cookie).send({ name: 'Not gh' }).expect(403);
    await api().post(`/api/oauth-apps/${GH}/secret`).set('cookie', owner.cookie).expect(403);
    await api().delete(`/api/oauth-apps/${GH}`).set('cookie', owner.cookie).expect(403);
    const [row] = await db.select({ name: schema.oauthClient.name }).from(schema.oauthClient).where(eq(schema.oauthClient.clientId, GH));
    expect(row?.name).toBe('GitHub CLI');
  });

  it('deletes an app with the keys it minted for every user, and nothing else', async () => {
    const { body } = await create(owner.cookie).expect(201);
    const auth = (userId: string, clientId: string) => db.insert(schema.apikey).values({ id: `k${clientId}${userId}`, referenceId: userId, key: `hash${clientId}${userId}`, name: 'k', metadata: JSON.stringify({ oauthClientId: clientId }), createdAt: new Date(), updatedAt: new Date() });
    await auth(owner.userId, body.clientId);
    await auth(other.userId, body.clientId);
    await auth(owner.userId, GH);
    await api().delete(`/api/oauth-apps/${body.clientId}`).set('cookie', owner.cookie).expect(204);
    await api().get(`/api/oauth-apps/${body.clientId}`).set('cookie', owner.cookie).expect(404);
    const keys = await db.select({ id: schema.apikey.id }).from(schema.apikey);
    const ids = keys.map((key) => key.id);
    expect(ids).not.toContain(`k${body.clientId}${owner.userId}`);
    expect(ids).not.toContain(`k${body.clientId}${other.userId}`);
    expect(ids).toContain(`k${GH}${owner.userId}`);
  });

  it('keeps a description and several callbacks, production and local alike', async () => {
    const callbackUrls = ['https://tool.example/callback', 'http://localhost:4000/cb'];
    const { body } = await create(owner.cookie, { description: 'Ships releases.', callbackUrls }).expect(201);
    expect(body).toMatchObject({ description: 'Ships releases.', callbackUrls, logoUrl: null });
    const updated = await api().patch(`/api/oauth-apps/${body.clientId}`).set('cookie', owner.cookie).send({ description: 'Ships faster.' }).expect(200);
    expect(updated.body).toMatchObject({ description: 'Ships faster.', callbackUrls, deviceFlowEnabled: false });
    const described = await api().get('/api/oauth-apps/authorize').query({ client_id: body.clientId }).set('cookie', other.cookie).expect(200);
    expect(described.body).toMatchObject({ description: 'Ships faster.', logoUrl: null });
  });

  it('refuses an empty, oversized or partly invalid callback list', async () => {
    await create(owner.cookie, { callbackUrls: [] }).expect(400);
    await create(owner.cookie, { callbackUrls: Array.from({ length: 11 }, (_, index) => `https://tool.example/${index}`) }).expect(400);
    await create(owner.cookie, { callbackUrls: ['https://tool.example/ok', 'http://tool.example/bad'] }).expect(400);
  });

  it('sets and removes a logo, which the consent page sees', async () => {
    const { body } = await create(owner.cookie).expect(201);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const uploaded = await api().put(`/api/oauth-apps/${body.clientId}/logo`).set('cookie', owner.cookie).set('content-type', 'image/png').send(png).expect(200);
    expect(uploaded.body.url).toMatch(/\.png$/);
    const described = await api().get('/api/oauth-apps/authorize').query({ client_id: body.clientId }).set('cookie', owner.cookie).expect(200);
    expect(described.body.logoUrl).toBe(uploaded.body.url);
    await api().put(`/api/oauth-apps/${body.clientId}/logo`).set('cookie', other.cookie).set('content-type', 'image/png').send(png).expect(404);
    await api().put(`/api/oauth-apps/${GH}/logo`).set('cookie', owner.cookie).set('content-type', 'image/png').send(png).expect(403);
    await api().delete(`/api/oauth-apps/${body.clientId}/logo`).set('cookie', owner.cookie).expect(204);
    expect((await api().get(`/api/oauth-apps/${body.clientId}`).set('cookie', owner.cookie).expect(200)).body.logoUrl).toBeNull();
  });

  it('accepts only an https or localhost callback', async () => {
    await create(owner.cookie, { callbackUrls: ['http://tool.example/callback'] }).expect(400);
    await create(owner.cookie, { callbackUrls: ['javascript:alert(1)'] }).expect(400);
    await create(owner.cookie, { callbackUrls: ['https://localhost/callback'] }).expect(400);
    await create(owner.cookie, { callbackUrls: ['http://127.0.0.1:8080/cb'] }).expect(201);
  });

  it('refuses an API key of any scope', async () => {
    const key = await scopedKey(app, owner.userId, ['repo', 'user']);
    await api().get('/api/oauth-apps').set('authorization', `Bearer ${key}`).expect(401);
    await api().get('/api/oauth-apps').set('x-api-key', owner.key).expect(401);
  });

  describe('authorized apps', () => {
    const key = (id: string, userId: string, clientId: string | null, scopes: string[]) =>
      db.insert(schema.apikey).values({ id, referenceId: userId, key: `hash-${id}`, name: 'k', permissions: JSON.stringify({ scopes }), metadata: clientId ? JSON.stringify({ oauthClientId: clientId }) : null, createdAt: new Date(), updatedAt: new Date() });
    const ids = async () => (await db.select({ id: schema.apikey.id }).from(schema.apikey)).map((row) => row.id);

    it('lists the apps holding a key for me, with their scopes', async () => {
      const a = (await create(other.cookie, { name: 'App A' }).expect(201)).body.clientId;
      await key(`la1${stamp}`, owner.userId, a, ['repo']);
      await key(`la2${stamp}`, owner.userId, a, ['gist', 'repo']);
      const list = await api().get('/api/oauth-apps/authorized').set('cookie', owner.cookie).expect(200);
      const entry = list.body.apps.find((each: { clientId: string }) => each.clientId === a);
      expect(entry).toMatchObject({ clientId: a, name: 'App A', scopes: ['gist', 'repo'], lastUsedAt: null });
      expect(entry.authorizedAt).toEqual(expect.any(String));
      const theirs = await api().get('/api/oauth-apps/authorized').set('cookie', other.cookie).expect(200);
      expect(theirs.body.apps.map((each: { clientId: string }) => each.clientId)).not.toContain(a);
    });

    it("revokes only my keys for that app, and its consent", async () => {
      const a = (await create(other.cookie, { name: 'App A' }).expect(201)).body.clientId;
      const b = (await create(other.cookie, { name: 'App B' }).expect(201)).body.clientId;
      await key(`ra-mine${stamp}`, owner.userId, a, ['repo']);
      await key(`ra-theirs${stamp}`, other.userId, a, ['repo']);
      await key(`rb-mine${stamp}`, owner.userId, b, ['repo']);
      await key(`r-ui${stamp}`, owner.userId, null, []);
      await db.insert(schema.oauthConsent).values({ id: `c${stamp}`, clientId: a, userId: owner.userId, scopes: ['repo'], createdAt: new Date(), updatedAt: new Date() });

      await api().delete(`/api/oauth-apps/authorized/${a}`).set('cookie', owner.cookie).expect(204);
      const left = await ids();
      expect(left).not.toContain(`ra-mine${stamp}`);
      expect(left).toEqual(expect.arrayContaining([`ra-theirs${stamp}`, `rb-mine${stamp}`, `r-ui${stamp}`]));
      expect(await db.select().from(schema.oauthConsent).where(eq(schema.oauthConsent.id, `c${stamp}`))).toEqual([]);
      await api().delete(`/api/oauth-apps/authorized/${a}`).set('cookie', owner.cookie).expect(404);
    });

    it('shows gh after the device flow, and revoking it locks gh out', async () => {
      const form = (text: string) => Object.fromEntries(new URLSearchParams(text));
      const code = form((await api().post('/login/device/code').type('form').send({ client_id: GH, scope: 'repo' }).expect(200)).text);
      await api().get('/api/auth/device').query({ user_code: code.user_code }).set('cookie', owner.cookie).expect(200);
      await api().post('/api/auth/device/approve').set('cookie', owner.cookie).send({ userCode: code.user_code }).expect(200);
      const token = form((await api().post('/login/oauth/access_token').type('form').send({ client_id: GH, device_code: code.device_code, grant_type: DEVICE_GRANT })).text);
      await api().get('/api/v3/user').set('authorization', `token ${token.access_token}`).expect(200);

      const list = await api().get('/api/oauth-apps/authorized').set('cookie', owner.cookie).expect(200);
      expect(list.body.apps).toEqual(expect.arrayContaining([expect.objectContaining({ clientId: GH, name: 'GitHub CLI', scopes: ['repo'] })]));
      await api().delete(`/api/oauth-apps/authorized/${GH}`).set('cookie', owner.cookie).expect(204);
      await api().get('/api/v3/user').set('authorization', `token ${token.access_token}`).expect(401);
    });
  });
});
