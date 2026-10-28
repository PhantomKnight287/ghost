import { createPrivateKey, sign } from 'node:crypto';

import { App } from '@octokit/app';
import type { INestApplication } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Auth } from '../src/lib/auth.js';
import { hasBackends, signUp, startApp } from './harness.js';

const UNDECODABLE = 'A JSON web token could not be decoded';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

describe.skipIf(!hasBackends)('GET /app', () => {
  let app: INestApplication;
  let origin: string;
  let owner: { cookie: string; key: string; userId: string };
  const stamp = Date.now();
  const ownerName = `gaowner${stamp}`;
  let apps = 0;
  const api = () => request(app.getHttpServer());

  const register = async (path = '/api/apps', cookie = owner.cookie) => {
    const { body } = await api()
      .post(path)
      .set('cookie', cookie)
      .send({
        name: `Reader ${stamp} ${apps++}`,
        homepageUrl: 'https://reader.example',
        permissions: { contents: 'read' },
        events: ['push'],
      })
      .expect(201);
    const key = await api()
      .post(`/api/apps/${body.slug}/private-keys`)
      .set('cookie', cookie)
      .expect(201);
    return {
      ...body,
      keyId: key.body.id as string,
      privateKey: key.body.privateKey as string,
    };
  };
  const readApp = (appId: number, privateKey: string) =>
    new App({ appId, privateKey }).octokit.request('GET /app', {
      baseUrl: `${origin}/api/v3`,
    });
  const jwtFor = (appId: number, privateKey: string) => {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const input = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: appId, iat: now - 30, exp: now + 540 })}`;
    return `${input}.${sign('sha256', Buffer.from(input), createPrivateKey(privateKey)).toString('base64url')}`;
  };

  beforeAll(async () => {
    ({ app, origin } = await startApp());
    owner = await signUp(app, ownerName);
    await api()
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: 'open', visibility: 'public' })
      .expect(201);
    await api()
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: 'secret', visibility: 'private' })
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("lets Octokit's App authenticate and read GET /app", async () => {
    const reader = await register();
    const { data } = await readApp(reader.appId, reader.privateKey);
    expect(data).toMatchObject({
      id: reader.appId,
      slug: reader.slug,
      name: reader.name,
      description: null,
      external_url: 'https://reader.example',
      permissions: { metadata: 'read', contents: 'read' },
      events: ['push'],
      installations_count: 0,
    });
    expect(data.node_id).toEqual(expect.any(String));
    expect(data.html_url).toMatch(new RegExp(`/apps/${reader.slug}$`));
    expect(data.owner).toMatchObject({ login: ownerName, type: 'User' });
    expect(Date.parse(data.created_at)).not.toBeNaN();
  });

  it('names an organization as the owner of its app', async () => {
    const organization = `gaorg${stamp}`;
    await app.get<AuthService<Auth>>(AuthService).api.createOrganization({
      body: { name: 'App Org', slug: organization },
      headers: new Headers({ cookie: owner.cookie }),
    });
    const reader = await register(`/api/organizations/${organization}/apps`);
    const { data } = await readApp(reader.appId, reader.privateKey);
    expect(data.owner).toMatchObject({
      login: organization,
      type: 'Organization',
    });
  });

  it('refuses a JWT signed by a deleted key', async () => {
    const reader = await register();
    const jwt = jwtFor(reader.appId, reader.privateKey);
    await api()
      .get('/api/v3/app')
      .set('authorization', `Bearer ${jwt}`)
      .expect(200);
    await api()
      .delete(`/api/apps/${reader.slug}/private-keys/${reader.keyId}`)
      .set('cookie', owner.cookie)
      .expect(204);
    const refused = await api()
      .get('/api/v3/app')
      .set('authorization', `Bearer ${jwt}`)
      .expect(401);
    expect(refused.body.message).toBe(UNDECODABLE);
  });

  it('refuses a JWT for a deleted app', async () => {
    const reader = await register();
    await api()
      .delete(`/api/apps/${reader.slug}`)
      .set('cookie', owner.cookie)
      .expect(204);
    const refused = await api()
      .get('/api/v3/app')
      .set('authorization', `Bearer ${jwtFor(reader.appId, reader.privateKey)}`)
      .expect(401);
    expect(refused.body.message).toBe(UNDECODABLE);
  });

  it('refuses a JWT for an App ID that does not exist', async () => {
    const reader = await register();
    await api()
      .get('/api/v3/app')
      .set('authorization', `Bearer ${jwtFor(2 ** 40, reader.privateKey)}`)
      .expect(401);
  });

  it('answers a user key or no credentials as GitHub answers a non-JWT', async () => {
    for (const call of [
      api().get('/api/v3/app').set('authorization', `token ${owner.key}`),
      api().get('/api/v3/app'),
      api().get('/api/v3/app').set('cookie', owner.cookie),
    ]) {
      const refused = await call.expect(401);
      expect(refused.body.message).toBe(UNDECODABLE);
    }
  });

  it('confines a JWT to the app routes', async () => {
    const reader = await register();
    const jwt = `Bearer ${jwtFor(reader.appId, reader.privateKey)}`;
    for (const call of [
      api().get('/api/v3/user'),
      api().get(`/api/v3/repos/${ownerName}/open`),
      api().get(`/api/v3/users/${ownerName}`),
      api().post('/api/graphql').send({ query: '{ viewer { login } }' }),
    ]) {
      const refused = await call.set('authorization', jwt).expect(403);
      expect(refused.body.message).toBe(
        'Resource not accessible by integration',
      );
    }
  });

  it('refuses a JWT as a git password', async () => {
    const reader = await register();
    const basic = Buffer.from(
      `x-access-token:${jwtFor(reader.appId, reader.privateKey)}`,
    ).toString('base64');
    await api()
      .get(`/${ownerName}/secret.git/info/refs?service=git-upload-pack`)
      .set('authorization', `Basic ${basic}`)
      .expect(401);
  });

  it('serves the bot as a Bot that links to its app', async () => {
    const reader = await register();
    const logo = await api()
      .put(`/api/apps/${reader.slug}/logo`)
      .set('cookie', owner.cookie)
      .set('content-type', 'image/png')
      .send(PNG)
      .expect(200);
    const { body } = await api()
      .get(`/api/v3/users/${encodeURIComponent(reader.botLogin)}`)
      .expect(200);
    expect(body).toMatchObject({
      login: reader.botLogin,
      type: 'Bot',
      avatar_url: logo.body.url,
    });
    expect(body.html_url).toMatch(new RegExp(`/apps/${reader.slug}$`));
    expect(body.node_id).toEqual(expect.any(String));
  });
});
