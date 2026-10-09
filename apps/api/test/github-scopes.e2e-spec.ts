import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, scopedKey, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)('GitHub scopes', () => {
  let app: INestApplication;
  let owner: { cookie: string; key: string; userId: string };
  const username = `ghscope${Date.now()}`;

  const graphql = (query: string, variables: object, token: string) =>
    request(app.getHttpServer())
      .post('/api/graphql')
      .set('authorization', `token ${token}`)
      .send({ query, variables });

  beforeAll(async () => {
    ({ app } = await startApp());
    owner = await signUp(app, username);
    for (const [name, visibility] of [
      ['public-repo', 'public'],
      ['secret-repo', 'private'],
    ]) {
      await request(app.getHttpServer())
        .post('/api/repositories')
        .set('cookie', owner.cookie)
        .send({ name, visibility })
        .expect(201);
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  it('reports a scoped key its own scopes, and a Ghost key every scope', async () => {
    const key = await scopedKey(app, owner.userId, ['read:org', 'gist']);
    const scoped = await request(app.getHttpServer())
      .get('/api/v3/')
      .set('authorization', `token ${key}`)
      .expect(200);
    expect(scoped.headers['x-oauth-scopes']).toBe('read:org, gist');
    const full = await request(app.getHttpServer())
      .get('/api/v3/')
      .set('authorization', `token ${owner.key}`)
      .expect(200);
    expect(full.headers['x-oauth-scopes']).toContain('repo');
  });

  it("never lets an API key into Ghost's own API", async () => {
    const key = await scopedKey(app, owner.userId, ['repo']);
    await request(app.getHttpServer())
      .get('/api/notifications')
      .set('authorization', `Bearer ${key}`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/notifications')
      .set('x-api-key', key)
      .expect(401);
  });

  it('hides a private repository from a key without repo, and shows it to one with repo', async () => {
    const publicOnly = await scopedKey(app, owner.userId, [
      'public_repo',
      'read:org',
    ]);
    const hidden = await graphql(
      'query($o: String!) { repository(owner: $o, name: "secret-repo") { name } }',
      { o: username },
      publicOnly,
    ).expect(200);
    expect(hidden.body.errors[0]).toMatchObject({ type: 'NOT_FOUND' });
    await request(app.getHttpServer())
      .get(`/api/v3/repos/${username}/secret-repo`)
      .set('authorization', `token ${publicOnly}`)
      .expect(404);
    const full = await scopedKey(app, owner.userId, ['repo']);
    const shown = await graphql(
      'query($o: String!) { repository(owner: $o, name: "secret-repo") { name } }',
      { o: username },
      full,
    ).expect(200);
    expect(shown.body.data.repository).toEqual({ name: 'secret-repo' });
  });

  it('lets public_repo write to a public repository and refuses a key with neither', async () => {
    const repo = await graphql(
      'query($o: String!) { repository(owner: $o, name: "public-repo") { id } }',
      { o: username },
      owner.key,
    ).expect(200);
    const repositoryId = repo.body.data.repository.id;
    const create = (token: string) =>
      graphql(
        'mutation($input: CreateIssueInput!) { createIssue(input: $input) { issue { title } } }',
        { input: { repositoryId, title: 'Scoped' } },
        token,
      ).expect(200);
    const allowed = await create(
      await scopedKey(app, owner.userId, ['public_repo']),
    );
    expect(allowed.body.data.createIssue.issue).toEqual({ title: 'Scoped' });
    const refused = await create(
      await scopedKey(app, owner.userId, ['read:org']),
    );
    expect(refused.body.errors[0]).toMatchObject({
      type: 'FORBIDDEN',
      message: expect.stringContaining(
        "The 'createIssue' field requires one of the following scopes: ['repo', 'public_repo']",
      ),
    });
  });

  it('answers a REST call without its scope with 403 and X-Accepted-OAuth-Scopes', async () => {
    const key = await scopedKey(app, owner.userId, ['repo']);
    const response = await request(app.getHttpServer())
      .get('/api/v3/user/keys')
      .set('authorization', `token ${key}`)
      .expect(403);
    expect(response.headers['x-accepted-oauth-scopes']).toBe('read:public_key');
  });

  it('refuses creating a private repository with public_repo only', async () => {
    const key = await scopedKey(app, owner.userId, ['public_repo']);
    await request(app.getHttpServer())
      .post('/api/v3/user/repos')
      .set('authorization', `token ${key}`)
      .send({ name: 'scoped-private', private: true })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v3/user/repos')
      .set('authorization', `token ${key}`)
      .send({ name: 'scoped-public' })
      .expect(201);
  });
});
