import { type Database, schema } from '@ghost/db';
import type { INestApplication } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import { hasBackends, signUp, startApp } from './harness.js';

const GH = '178c6fc778ccc68e1d6a';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

describe.skipIf(!hasBackends)('GitHub OAuth device flow', () => {
  let app: INestApplication;
  let owner: { cookie: string; key: string; userId: string };
  const username = `ghoauth${Date.now()}`;
  const api = () => request(app.getHttpServer());
  const requestCode = (scope = 'repo read:org gist workflow', clientId = GH) => api().post('/login/device/code').type('form').send({ client_id: clientId, scope });
  const poll = (deviceCode: string, clientId = GH) => api().post('/login/oauth/access_token').type('form').send({ client_id: clientId, device_code: deviceCode, grant_type: DEVICE_GRANT });
  const form = (text: string) => Object.fromEntries(new URLSearchParams(text));
  const decide = async (userCode: string, decision: 'approve' | 'deny') => {
    await api().get('/api/auth/device').query({ user_code: userCode }).set('cookie', owner.cookie).expect(200);
    await api().post(`/api/auth/device/${decision}`).set('cookie', owner.cookie).send({ userCode }).expect(200);
  };

  beforeAll(async () => {
    ({ app } = await startApp({ WEB_APP_URL: 'https://web.example' }));
    owner = await signUp(app, username);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('hands gh a device code, form-encoded, with the web /device page to visit', async () => {
    const response = await requestCode().expect(200);
    expect(response.headers['content-type']).toMatch(/application\/x-www-form-urlencoded/);
    const code = form(response.text);
    expect(code).toMatchObject({ verification_uri: 'https://web.example/device', interval: '5', expires_in: '1800' });
    expect(code.user_code).toMatch(/^\w+$/);
    expect(code.device_code).toBeTruthy();
  });

  it('answers JSON when asked, and refuses an unknown client so gh does not loop', async () => {
    const json = await requestCode().set('accept', 'application/json').expect(200);
    expect(json.body).toMatchObject({ verification_uri: 'https://web.example/device', interval: 5 });
    await api().post('/login/device/code').type('form').send({ client_id: 'nope', scope: 'repo' }).expect(400);
  });

  it('answers authorization_pending before approval, and access_denied after a deny', async () => {
    const pending = form((await requestCode().expect(200)).text);
    expect(form((await poll(pending.device_code)).text)).toMatchObject({ error: 'authorization_pending' });

    const denied = form((await requestCode().expect(200)).text);
    await decide(denied.user_code, 'deny');
    expect(form((await poll(denied.device_code)).text)).toMatchObject({ error: 'access_denied' });
  });

  it('mints a ghost_pat_ key with the known scopes gh asked for, never the session', async () => {
    const code = form((await requestCode().expect(200)).text);
    await decide(code.user_code, 'approve');
    expect(form((await poll(code.device_code, 'someone-else')).text)).toMatchObject({ error: 'invalid_client' });
    const token = form((await poll(code.device_code)).text);
    expect(token).toMatchObject({ token_type: 'bearer', scope: 'repo,read:org,gist' });
    expect(token.access_token).toMatch(/^ghost_pat_/);
    const status = await api().get('/api/v3/').set('authorization', `token ${token.access_token}`).expect(200);
    expect(status.headers['x-oauth-scopes']).toBe('repo, read:org, gist');
    expect(form((await poll(code.device_code)).text).error).toBeTruthy();
  });

  it('ignores a client_secret sent with the device grant', async () => {
    const code = form((await requestCode().expect(200)).text);
    await decide(code.user_code, 'approve');
    const response = await api().post('/login/oauth/access_token').type('form').send({ client_id: GH, client_secret: 'anything', device_code: code.device_code, grant_type: DEVICE_GRANT });
    expect(form(response.text).access_token).toMatch(/^ghost_pat_/);
  });

  it('refuses a device code to a user app with device flow off, and runs the flow once it is on', async () => {
    const db = app.get<Database>(DATABASE);
    const clientId = `tool${Date.now()}`;
    await db.insert(schema.oauthClient).values({ id: clientId, clientId, name: 'Scoped Tool', userId: owner.userId, redirectUris: ['https://tool.example/callback'], metadata: { deviceFlow: false } });
    const refused = await requestCode('repo', clientId).expect(400);
    expect(form(refused.text)).toMatchObject({ error: 'unauthorized_client' });

    await db.update(schema.oauthClient).set({ metadata: { deviceFlow: true } }).where(eq(schema.oauthClient.clientId, clientId));
    const code = form((await requestCode('repo', clientId).expect(200)).text);
    await decide(code.user_code, 'approve');
    const token = form((await poll(code.device_code, clientId)).text);
    expect(token.access_token).toMatch(/^ghost_pat_/);
    const [key] = await db.select({ name: schema.apikey.name, metadata: schema.apikey.metadata }).from(schema.apikey).where(and(eq(schema.apikey.referenceId, owner.userId), eq(schema.apikey.name, 'Scoped Tool')));
    expect(JSON.parse(key?.metadata ?? '{}')).toEqual({ oauthClientId: clientId });
  });
});
