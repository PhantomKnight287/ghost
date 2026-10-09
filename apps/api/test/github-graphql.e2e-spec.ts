import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)('GitHub GraphQL', () => {
  let app: INestApplication;
  let owner: { cookie: string; key: string; userId: string };
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
    const response = await graphql('{ __typename }', {}, 'ghost_pat_nope').expect(401);
    expect(response.body.message).toBe('Bad credentials');
  });

});
