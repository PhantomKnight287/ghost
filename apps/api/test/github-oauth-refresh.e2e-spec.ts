import { type Database, schema } from '@ghost/db';
import type { INestApplication } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import { hashRefreshToken } from '../src/lib/github/refresh-tokens.js';
import { hasBackends, signUp, startApp } from './harness.js';

const CALLBACK = 'https://tool.example/oauth/callback';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

describe.skipIf(!hasBackends)('GitHub OAuth expiring tokens and refresh', () => {
  let app: INestApplication;
  let db: Database;
  let owner: { cookie: string; key: string; userId: string };
  let clientId: string;
  let clientSecret: string;
  const api = () => request(app.getHttpServer());
  const form = (text: string) => Object.fromEntries(new URLSearchParams(text));
  const register = async (body: object = {}) => (await api().post('/api/oauth-apps').set('cookie', owner.cookie).send({ name: 'Expiring Tool', homepageUrl: 'https://tool.example', callbackUrls: [CALLBACK], expireUserTokens: true, ...body }).expect(201)).body as { clientId: string; clientSecret: string };
  const codeFor = async (client: string) => {
    const first = await api().get('/login/oauth/authorize').query({ client_id: client, scope: 'repo' }).set('cookie', owner.cookie).expect(302);
    const plugin = new URL(first.headers.location, 'http://api.local');
    let callback = new URL((await api().get(`${plugin.pathname}${plugin.search}`).set('cookie', owner.cookie).expect(302)).headers.location);
    if (callback.searchParams.has('sig')) callback = new URL((await api().post('/api/auth/oauth2/consent').set('cookie', owner.cookie).send({ accept: true, oauth_query: callback.search.slice(1) }).expect(200)).body.url);
    return callback.searchParams.get('code') as string;
  };
  const exchange = async (client = clientId, secret = clientSecret, accept = 'application/x-www-form-urlencoded') => api().post('/login/oauth/access_token').set('accept', accept).type('form').send({ client_id: client, client_secret: secret, code: await codeFor(client) }).expect(200);
  const refresh = (refreshToken: string, body: Record<string, string> = {}) => api().post('/login/oauth/access_token').type('form').send({ client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken, ...body }).expect(200);
  const newestKey = async () => (await db.select({ id: schema.apikey.id, expiresAt: schema.apikey.expiresAt }).from(schema.apikey).where(eq(schema.apikey.referenceId, owner.userId)).orderBy(desc(schema.apikey.createdAt)).limit(1))[0];

  beforeAll(async () => {
    ({ app } = await startApp({ WEB_APP_URL: 'https://web.example' }));
    db = app.get<Database>(DATABASE);
    owner = await signUp(app, `ghrt${Date.now()}`);
    ({ clientId, clientSecret } = await register());
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('issuing', () => {
    it('adds no expiry and no refresh token while the switch is off', async () => {
      const off = await register({ expireUserTokens: false });
      const token = form((await exchange(off.clientId, off.clientSecret)).text);
      expect(token).toEqual({ access_token: expect.stringMatching(/^ghost_pat_/), token_type: 'bearer', scope: 'repo' });
      expect((await newestKey())?.expiresAt).toBeNull();
    });

    it("answers the code grant with GitHub's expiring token fields, form-encoded and JSON", async () => {
      const token = form((await exchange()).text);
      expect(token).toEqual({ access_token: expect.stringMatching(/^ghost_pat_/), expires_in: '28800', refresh_token: expect.stringMatching(/^ghost_rt_/), refresh_token_expires_in: '15897600', token_type: 'bearer', scope: 'repo' });
      const json = (await exchange(clientId, clientSecret, 'application/json')).body;
      expect(json).toMatchObject({ expires_in: 28800, refresh_token_expires_in: 15897600, refresh_token: expect.stringMatching(/^ghost_rt_/) });
      const [row] = await db.select({ expiresAt: schema.oauthAppRefreshToken.expiresAt }).from(schema.oauthAppRefreshToken).where(eq(schema.oauthAppRefreshToken.tokenHash, hashRefreshToken(json.refresh_token)));
      expect(row?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 15897600 * 1000 - 60_000);
    });

    it('gives the key an 8-hour expiry that the token guard enforces', async () => {
      const token = form((await exchange()).text);
      const key = await newestKey();
      expect((key?.expiresAt as Date).getTime() - Date.now()).toBeGreaterThan(28800 * 1000 - 60_000);
      await api().get('/api/v3/user').set('authorization', `token ${token.access_token}`).expect(200);
      await db.update(schema.apikey).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.apikey.id, key?.id as string));
      await api().get('/api/v3/user').set('authorization', `token ${token.access_token}`).expect(401);
    });

    it('answers the device grant with a refresh token too', async () => {
      const device = await register({ deviceFlowEnabled: true });
      const code = form((await api().post('/login/device/code').type('form').send({ client_id: device.clientId, scope: 'repo' }).expect(200)).text);
      await api().get('/api/auth/device').query({ user_code: code.user_code }).set('cookie', owner.cookie).expect(200);
      await api().post('/api/auth/device/approve').set('cookie', owner.cookie).send({ userCode: code.user_code }).expect(200);
      const token = form((await api().post('/login/oauth/access_token').type('form').send({ client_id: device.clientId, device_code: code.device_code, grant_type: DEVICE_GRANT }).expect(200)).text);
      expect(token).toMatchObject({ expires_in: '28800', refresh_token: expect.stringMatching(/^ghost_rt_/), refresh_token_expires_in: '15897600', scope: 'repo' });
    });
  });

  describe('refreshing', () => {
    const pair = async () => form((await exchange()).text);

    it('trades a refresh token for a new pair with the same scopes, and retires the old pair', async () => {
      const first = await pair();
      const next = form((await refresh(first.refresh_token as string)).text);
      expect(next).toEqual({ access_token: expect.stringMatching(/^ghost_pat_/), expires_in: '28800', refresh_token: expect.stringMatching(/^ghost_rt_/), refresh_token_expires_in: '15897600', token_type: 'bearer', scope: 'repo' });
      expect(next.access_token).not.toBe(first.access_token);
      const user = await api().get('/api/v3/user').set('authorization', `token ${next.access_token}`).expect(200);
      expect(user.headers['x-oauth-scopes']).toBe('repo');
      await api().get('/api/v3/user').set('authorization', `token ${first.access_token}`).expect(401);
      expect(form((await refresh(first.refresh_token as string)).text)).toEqual({ error: 'bad_refresh_token', error_description: 'The refresh token passed is incorrect or expired.' });
    });

    it('answers JSON when asked', async () => {
      const response = await refresh((await pair()).refresh_token as string).set('accept', 'application/json');
      expect(response.body).toMatchObject({ expires_in: 28800, refresh_token_expires_in: 15897600, token_type: 'bearer' });
    });

    it('lets only one of two concurrent refreshes with the same token win', async () => {
      const { refresh_token } = await pair();
      const answers = await Promise.all([refresh(refresh_token as string), refresh(refresh_token as string)]);
      const tokens = answers.map((answer) => form(answer.text));
      expect(tokens.filter((token) => token.access_token)).toHaveLength(1);
      expect(tokens.filter((token) => token.error === 'bad_refresh_token')).toHaveLength(1);
    });

    it('refuses an expired refresh token and an unknown one', async () => {
      const { refresh_token } = await pair();
      await db.update(schema.oauthAppRefreshToken).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.oauthAppRefreshToken.tokenHash, hashRefreshToken(refresh_token as string)));
      expect(form((await refresh(refresh_token as string)).text).error).toBe('bad_refresh_token');
      expect(form((await refresh('ghost_rt_nope')).text).error).toBe('bad_refresh_token');
    });

    it("refuses another app's refresh token and leaves it working for its own app", async () => {
      const { refresh_token } = await pair();
      const other = await register({ name: 'Other Tool' });
      expect(form((await refresh(refresh_token as string, { client_id: other.clientId, client_secret: other.clientSecret })).text).error).toBe('bad_refresh_token');
      expect(form((await refresh(refresh_token as string)).text).access_token).toMatch(/^ghost_pat_/);
    });

    it('refuses a wrong or missing client secret, and an unknown client, and spends nothing', async () => {
      const { refresh_token } = await pair();
      expect(form((await refresh(refresh_token as string, { client_secret: 'wrong' })).text)).toMatchObject({ error: 'incorrect_client_credentials' });
      const missing = await api().post('/login/oauth/access_token').type('form').send({ client_id: clientId, grant_type: 'refresh_token', refresh_token }).expect(200);
      expect(form(missing.text)).toMatchObject({ error: 'incorrect_client_credentials' });
      expect(form((await refresh(refresh_token as string, { client_id: 'nope' })).text)).toMatchObject({ error: 'incorrect_client_credentials' });
      expect(form((await refresh(refresh_token as string)).text).access_token).toMatch(/^ghost_pat_/);
    });

    it('stops refreshing once the user revokes the app', async () => {
      const revoked = await register({ name: 'Revoked Tool' });
      const first = form((await exchange(revoked.clientId, revoked.clientSecret)).text);
      await api().delete(`/api/oauth-apps/authorized/${revoked.clientId}`).set('cookie', owner.cookie).expect(204);
      expect(form((await refresh(first.refresh_token as string, { client_id: revoked.clientId, client_secret: revoked.clientSecret })).text).error).toBe('bad_refresh_token');
    });

    it('moves to keys that never expire once the switch is turned off', async () => {
      const toggled = await register({ name: 'Toggled Tool' });
      const credentials = { client_id: toggled.clientId, client_secret: toggled.clientSecret };
      const first = form((await exchange(toggled.clientId, toggled.clientSecret)).text);
      await api().patch(`/api/oauth-apps/${toggled.clientId}`).set('cookie', owner.cookie).send({ expireUserTokens: false }).expect(200);
      const next = form((await refresh(first.refresh_token as string, credentials)).text);
      expect(next).toEqual({ access_token: expect.stringMatching(/^ghost_pat_/), token_type: 'bearer', scope: 'repo' });
      expect((await newestKey())?.expiresAt).toBeNull();
      await api().get('/api/v3/user').set('authorization', `token ${first.access_token}`).expect(401);
      expect(form((await refresh(first.refresh_token as string, credentials)).text).error).toBe('bad_refresh_token');
    });
  });
});
