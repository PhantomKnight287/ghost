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
});
