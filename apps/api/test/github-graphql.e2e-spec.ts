import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)('GitHub GraphQL', () => {
  let app: INestApplication;
  let owner: { cookie: string; key: string; userId: string };
  let stranger: { cookie: string; key: string; userId: string };
  const username = `ghgql${Date.now()}`;

  const graphql = (query: string, variables: object = {}, token?: string) => {
    const call = request(app.getHttpServer())
      .post('/api/graphql')
      .send({ query, variables });
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
    stranger = await signUp(app, `${username}x`);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('answers a query at /api/graphql', async () => {
    const response = await graphql('{ __typename }').expect(200);
    expect(response.body).toEqual({ data: { __typename: 'Query' } });
  });

  it('answers introspection, which gh sends to enterprise hosts', async () => {
    const response = await graphql('{ __type(name: "Query") { name } }').expect(
      200,
    );
    expect(response.body.data.__type.name).toBe('Query');
  });

  it('refuses a wrong token with 401 Bad credentials', async () => {
    const response = await graphql(
      '{ __typename }',
      {},
      'ghost_pat_nope',
    ).expect(401);
    expect(response.body.message).toBe('Bad credentials');
  });
  it('answers viewer with the token owner', async () => {
    const response = await graphql(
      '{ viewer { __typename id login name url resourcePath avatarUrl } }',
      {},
      owner.key,
    ).expect(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.viewer).toMatchObject({
      __typename: 'User',
      login: username,
      resourcePath: `/${username}`,
    });
    expect(response.body.data.viewer.id).toMatch(/^U_/);
  });

  it('refuses viewer anonymously, as GitHub does', async () => {
    const response = await graphql('{ viewer { login } }').expect(200);
    expect(response.body.errors[0].type).toBe('FORBIDDEN');
  });

  it('resolves user, repositoryOwner and node by id', async () => {
    const response = await graphql(
      'query($login: String!) { user(login: $login) { id login } repositoryOwner(login: $login) { __typename login } }',
      { login: username },
    ).expect(200);
    expect(response.body.data.repositoryOwner).toEqual({
      __typename: 'User',
      login: username,
    });
    const node = await graphql(
      'query($id: ID!) { node(id: $id) { __typename ... on User { login } } }',
      { id: response.body.data.user.id },
    ).expect(200);
    expect(node.body.data.node).toEqual({
      __typename: 'User',
      login: username,
    });
  });

  it('answers a missing user as NOT_FOUND with GitHub wording', async () => {
    const response = await graphql(
      '{ user(login: "nobody-here-xyz") { login } }',
    ).expect(200);
    expect(response.body.data.user).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      type: 'NOT_FOUND',
      message:
        "Could not resolve to a User with the login of 'nobody-here-xyz'.",
    });
  });

  const REPO_QUERY =
    'query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id databaseId name nameWithOwner owner { login } sshUrl url hasIssuesEnabled hasWikiEnabled description isPrivate visibility viewerPermission defaultBranchRef { name } parent { name } mergeCommitAllowed rebaseMergeAllowed squashMergeAllowed } }';

  it('answers the repository fields gh reads before every command', async () => {
    const response = await graphql(
      REPO_QUERY,
      { owner: username, name: 'public-repo' },
      owner.key,
    ).expect(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.repository).toMatchObject({
      databaseId: null,
      name: 'public-repo',
      nameWithOwner: `${username}/public-repo`,
      owner: { login: username },
      hasIssuesEnabled: true,
      hasWikiEnabled: false,
      isPrivate: false,
      visibility: 'PUBLIC',
      viewerPermission: 'ADMIN',
      parent: null,
      mergeCommitAllowed: true,
    });
    expect(response.body.data.repository.id).toMatch(/^R_/);
  });

  it.each([
    ['anonymous', () => undefined],
    ['a stranger', () => stranger.key],
  ])('answers a private repository as NOT_FOUND for %s', async (_, token) => {
    const response = await graphql(
      REPO_QUERY,
      { owner: username, name: 'secret-repo' },
      token(),
    ).expect(200);
    expect(response.body.data.repository).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      type: 'NOT_FOUND',
      message: `Could not resolve to a Repository with the name '${username}/secret-repo'.`,
    });
  });
});
