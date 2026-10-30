import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, signUp, startApp } from './harness.js';

const CALLBACK = 'https://tool.example/oauth/callback';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

describe.skipIf(!hasBackends)('Ghost App user-to-server tokens', () => {
  let app: INestApplication;
  let owner: { cookie: string; key: string; userId: string };
  const stamp = Date.now();
  let apps = 0;
  const api = () => request(app.getHttpServer());

  /** A Ghost App with a callback and one client secret. */
  const register = async (settings: object = {}) => {
    const { body } = await api()
      .post('/api/apps')
      .set('cookie', owner.cookie)
      .send({
        name: `User Tokens ${stamp} ${apps++}`,
        homepageUrl: 'https://tool.example',
        permissions: { issues: 'write' },
        events: [],
        callbackUrls: [CALLBACK],
        ...settings,
      })
      .expect(201);
    const secret = await api()
      .post(`/api/apps/${body.slug}/client-secrets`)
      .set('cookie', owner.cookie)
      .expect(201);
    return {
      slug: body.slug as string,
      clientId: body.clientId as string,
      clientSecret: secret.body.clientSecret as string,
    };
  };
  const codeFor = async (clientId: string, query: object = {}) => {
    const first = await api()
      .get('/login/oauth/authorize')
      .query({ client_id: clientId, ...query })
      .set('cookie', owner.cookie)
      .expect(302);
    const plugin = new URL(first.headers.location, 'http://api.local');
    const second = await api()
      .get(`${plugin.pathname}${plugin.search}`)
      .set('cookie', owner.cookie)
      .expect(302);
    let callback = new URL(second.headers.location);
    if (callback.searchParams.has('sig')) {
      const consented = await api()
        .post('/api/auth/oauth2/consent')
        .set('cookie', owner.cookie)
        .send({ accept: true, oauth_query: callback.search.slice(1) })
        .expect(200);
      callback = new URL(consented.body.url);
    }
    return callback.searchParams.get('code') as string;
  };
  const token = (body: object) =>
    api()
      .post('/login/oauth/access_token')
      .set('accept', 'application/json')
      .type('form')
      .send(body)
      .expect(200);
  const webFlow = async (
    client: { clientId: string; clientSecret: string },
    query: object = {},
  ) =>
    (
      await token({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        code: await codeFor(client.clientId, query),
      })
    ).body;

  beforeAll(async () => {
    ({ app } = await startApp({ WEB_APP_URL: 'https://web.example' }));
    owner = await signUp(app, `ghuowner${stamp}`);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('the web flow returns a ghu_ token and a ghr_ refresh token with empty scope', async () => {
    const client = await register();
    const body = await webFlow(client, { scope: 'repo' });
    expect(body).toEqual({
      access_token: expect.stringMatching(/^ghu_[A-Za-z0-9]{36}$/),
      token_type: 'bearer',
      scope: '',
      expires_in: 28800,
      refresh_token: expect.stringMatching(/^ghr_[A-Za-z0-9]{76}$/),
      refresh_token_expires_in: 15897600,
    });
  });

  it('refuses a wrong client secret, and accepts any of the app’s secrets', async () => {
    const client = await register();
    const wrong = await token({
      client_id: client.clientId,
      client_secret: 'ghost_cs_nope',
      code: await codeFor(client.clientId),
    });
    expect(wrong.body.error).toBe('incorrect_client_credentials');

    const second = await api()
      .post(`/api/apps/${client.slug}/client-secrets`)
      .set('cookie', owner.cookie)
      .expect(201);
    const body = await webFlow({
      clientId: client.clientId,
      clientSecret: second.body.clientSecret,
    });
    expect(body.access_token).toMatch(/^ghu_/);
  });

  it('the device flow works when enabled and answers unauthorized_client when not', async () => {
    const off = await register();
    const refused = await api()
      .post('/login/device/code')
      .type('form')
      .send({ client_id: off.clientId })
      .expect(400);
    expect(refused.text).toContain('unauthorized_client');

    const on = await register({ deviceFlowEnabled: true });
    const code = await api()
      .post('/login/device/code')
      .set('accept', 'application/json')
      .type('form')
      .send({ client_id: on.clientId })
      .expect(200);
    await api()
      .get('/api/auth/device')
      .query({ user_code: code.body.user_code })
      .set('cookie', owner.cookie)
      .expect(200);
    await api()
      .post('/api/auth/device/approve')
      .set('cookie', owner.cookie)
      .send({ userCode: code.body.user_code })
      .expect(200);
    const granted = await token({
      client_id: on.clientId,
      device_code: code.body.device_code,
      grant_type: DEVICE_GRANT,
    });
    expect(granted.body).toMatchObject({
      access_token: expect.stringMatching(/^ghu_/),
      refresh_token: expect.stringMatching(/^ghr_/),
      scope: '',
    });
  });

  it('a refresh spends the ghr_ token, revokes the old ghu_ and returns a new pair', async () => {
    const client = await register();
    const first = await webFlow(client);
    const refreshed = await token({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: first.refresh_token,
    });
    expect(refreshed.body).toMatchObject({
      access_token: expect.stringMatching(/^ghu_/),
      refresh_token: expect.stringMatching(/^ghr_/),
    });
    expect(refreshed.body.access_token).not.toBe(first.access_token);
    await api()
      .get('/api/v3/user')
      .set('authorization', `token ${first.access_token}`)
      .expect(401);

    const again = await token({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: first.refresh_token,
    });
    expect(again.body.error).toBe('bad_refresh_token');
  });

  it('a refresh after expiry is turned off returns a token that never expires', async () => {
    const client = await register();
    const first = await webFlow(client);
    await api()
      .patch(`/api/apps/${client.slug}`)
      .set('cookie', owner.cookie)
      .send({ expireUserTokens: false })
      .expect(200);
    const refreshed = await token({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: first.refresh_token,
    });
    expect(refreshed.body).toEqual({
      access_token: expect.stringMatching(/^ghu_/),
      token_type: 'bearer',
      scope: '',
    });
  });

  it('with expiry off, the token has no expires_in or refresh_token', async () => {
    const client = await register({ expireUserTokens: false });
    expect(await webFlow(client)).toEqual({
      access_token: expect.stringMatching(/^ghu_/),
      token_type: 'bearer',
      scope: '',
    });
  });

  it('a ghu_ token answers GET /api/v3/user as the user', async () => {
    const client = await register();
    const { access_token } = await webFlow(client);
    const { body } = await api()
      .get('/api/v3/user')
      .set('authorization', `token ${access_token}`)
      .expect(200);
    expect(body.login).toBe(`ghuowner${stamp}`);
  });
});
