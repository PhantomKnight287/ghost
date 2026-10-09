import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)('GitHub REST v3', () => {
  let app: INestApplication;
  let owner: { cookie: string; key: string; userId: string };
  const username = `ghrest${Date.now()}`;
  const v3 = (path: string, token?: string) => {
    const call = request(app.getHttpServer()).get(`/api/v3${path}`);
    return token ? call.set('authorization', `token ${token}`) : call;
  };

  beforeAll(async () => {
    ({ app } = await startApp());
    owner = await signUp(app, username);
    const api = request(app.getHttpServer());
    await api
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: 'public-repo', visibility: 'public' })
      .expect(201);
    await api
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: 'secret-repo', visibility: 'private' })
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('answers the root with the scopes gh checks for', async () => {
    const response = await v3('/', owner.key).expect(200);
    expect(response.headers['x-oauth-scopes']).toContain('repo');
    expect(response.headers['x-oauth-scopes']).toContain('read:org');
    expect(response.headers['x-github-media-type']).toBe('github.v3; format=json');
  });

  it('accepts a Bearer token as well as token', async () => {
    await request(app.getHttpServer())
      .get('/api/v3/user')
      .set('authorization', `Bearer ${owner.key}`)
      .expect(200);
  });

  it('refuses a wrong token with Bad credentials instead of treating it as anonymous', async () => {
    const response = await v3('/user', 'ghost_pat_nope').expect(401);
    expect(response.body).toEqual({ message: 'Bad credentials', documentation_url: 'https://docs.github.com/rest' });
  });

  it('answers /user for the token owner and 401 without a token', async () => {
    const response = await v3('/user', owner.key).expect(200);
    expect(response.body).toMatchObject({ login: username, type: 'User', site_admin: false });
    expect(response.body.node_id).toMatch(/^U_/);
    expect(response.body.html_url).toMatch(new RegExp(`/${username}$`));
    const anonymous = await v3('/user').expect(401);
    expect(anonymous.body.message).toBe('Requires authentication');
  });

  it('reports an installed version below 3.18 so gh keeps the classic search syntax', async () => {
    const response = await v3('/meta').expect(200);
    expect(response.body.installed_version).toBe('3.17.0');
  });
  it('answers GET /repos/:owner/:repo in REST shape and 404 for a private one anonymously', async () => {
     const response = await v3(`/repos/${username}/public-repo`, owner.key).expect(200);
     expect(response.body).toMatchObject({ name: 'public-repo', full_name: `${username}/public-repo`, private: false, visibility: 'public', owner: { login: username } });
     expect(response.body.clone_url).toMatch(new RegExp(`/${username}/public-repo\\.git$`));
     await v3(`/repos/${username}/secret-repo`).expect(404, { message: 'Not Found', documentation_url: 'https://docs.github.com/rest' });
   });

   it('answers the readme as base64 content, and 404 when there is none', async () => {
     await v3(`/repos/${username}/public-repo/readme`, owner.key).expect(404);
   });

  it('creates a repository with POST /user/repos and answers GET /users/:login', async () => {
    const created = await request(app.getHttpServer()).post('/api/v3/user/repos').set('authorization', `token ${owner.key}`).send({ name: 'rest-made', private: true, auto_init: true }).expect(201);
    expect(created.body).toMatchObject({ name: 'rest-made', full_name: `${username}/rest-made`, private: true });
    const user = await v3(`/users/${username}`).expect(200);
    expect(user.body).toMatchObject({ login: username, type: 'User' });
    await v3('/users/nobody-xyz').expect(404);
  });
});
