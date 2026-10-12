import type { INestApplication } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Auth } from '../src/lib/auth.js';
import { hasBackends, signUp, startApp } from './harness.js';

const GH = '178c6fc778ccc68e1d6a';

/** Organization OAuth app access restrictions: an app the organization has not approved reaches none of its repositories, over GraphQL, REST or git, while keys made in Ghost, apps built into it and the organization's own apps keep working. */
describe.skipIf(!hasBackends)('OAuth app access restrictions', () => {
  let app: INestApplication;
  let owner: { cookie: string; key: string; userId: string };
  let member: { cookie: string; key: string; userId: string };
  let developer: { cookie: string; key: string; userId: string };
  let thirdParty: string;
  let organizationApp: string;
  const stamp = Date.now();
  const org = `oaaccess${stamp}`;
  const api = () => request(app.getHttpServer());
  const auth = () => app.get<AuthService<Auth>>(AuthService).api;
  /** A key as an OAuth app is given one, the way the token endpoint mints it. */
  const appKey = async (userId: string, clientId: string) =>
    (
      await auth().createApiKey({
        body: {
          userId,
          permissions: { scopes: ['repo', 'read:org'] },
          metadata: { oauthClientId: clientId },
        },
      })
    ).key;
  const restrict = (on: boolean) =>
    api()
      .patch(`/api/organizations/${org}/settings`)
      .set('cookie', owner.cookie)
      .send({ oauthAppRestrictions: on })
      .expect(200);
  const rest = (key: string) =>
    api()
      .get(`/api/v3/repos/${org}/secret`)
      .set('authorization', `token ${key}`);
  const graphql = async (key: string) =>
    (
      await api()
        .post('/api/graphql')
        .set('authorization', `token ${key}`)
        .send({
          query: `{ repository(owner: "${org}", name: "secret") { name } }`,
        })
        .expect(200)
    ).body;
  const git = (key: string) =>
    api()
      .get(`/${org}/secret.git/info/refs?service=git-upload-pack`)
      .set(
        'authorization',
        `Basic ${Buffer.from(`x:${key}`).toString('base64')}`,
      );

  beforeAll(async () => {
    ({ app } = await startApp());
    owner = await signUp(app, `oaaccessowner${stamp}`);
    member = await signUp(app, `oaaccessmember${stamp}`);
    developer = await signUp(app, `oaaccessdev${stamp}`);
    const organizationId = (await auth().createOrganization({
      body: { name: 'Access Org', slug: org },
      headers: new Headers({ cookie: owner.cookie }),
    }))!.id;
    await auth().addMember({
      body: { userId: member.userId, role: 'member', organizationId },
    });
    await api()
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: 'secret', visibility: 'private', organization: org })
      .expect(201);
    const apps = {
      name: 'Tool',
      homepageUrl: 'https://tool.example',
      callbackUrls: ['https://tool.example/callback'],
    };
    thirdParty = (
      await api()
        .post('/api/oauth-apps')
        .set('cookie', developer.cookie)
        .send(apps)
        .expect(201)
    ).body.clientId;
    organizationApp = (
      await api()
        .post(`/api/organizations/${org}/oauth-apps`)
        .set('cookie', owner.cookie)
        .send(apps)
        .expect(201)
    ).body.clientId;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lets every app in while restrictions are off', async () => {
    const key = await appKey(member.userId, thirdParty);
    await rest(key).expect(200);
    expect(await graphql(key)).toEqual({
      data: { repository: { name: 'secret' } },
    });
    await git(key).expect(200);
  });

  it('hides the repositories from an app the organization has not approved, everywhere', async () => {
    await restrict(true);
    const key = await appKey(member.userId, thirdParty);
    await rest(key).expect(404);
    expect((await graphql(key)).errors[0]).toMatchObject({ type: 'NOT_FOUND' });
    await git(key).expect(404);
    expect(
      (
        await api()
          .post(`/api/v3/orgs/${org}/repos`)
          .set(
            'authorization',
            `token ${await appKey(owner.userId, thirdParty)}`,
          )
          .send({ name: 'from-app' })
          .expect(403)
      ).body.message,
    ).toContain('has enabled OAuth App access restrictions');
  });

  it('keeps keys made in Ghost, apps built into it, and its own apps working', async () => {
    await rest(member.key).expect(200);
    await rest(await appKey(member.userId, GH)).expect(200);
    await rest(await appKey(member.userId, organizationApp)).expect(200);
  });

  it('takes a member’s request, and an admin’s approval lets the app in until it is revoked', async () => {
    const key = await appKey(member.userId, thirdParty);
    const asked = await api()
      .post(`/api/organizations/${org}/oauth-app-access/${thirdParty}/request`)
      .set('cookie', member.cookie)
      .expect(201);
    expect(asked.body).toMatchObject({
      clientId: thirdParty,
      state: 'requested',
      requestedBy: `oaaccessmember${stamp}`,
      decidedBy: null,
    });
    await api()
      .post(`/api/organizations/${org}/oauth-app-access/${thirdParty}/request`)
      .set('cookie', developer.cookie)
      .expect(404);
    await api()
      .get(`/api/organizations/${org}/oauth-app-access`)
      .set('cookie', member.cookie)
      .expect(403);
    await api()
      .put(`/api/organizations/${org}/oauth-app-access/${thirdParty}`)
      .set('cookie', member.cookie)
      .send({ state: 'approved' })
      .expect(403);

    const approved = await api()
      .put(`/api/organizations/${org}/oauth-app-access/${thirdParty}`)
      .set('cookie', owner.cookie)
      .send({ state: 'approved' })
      .expect(200);
    expect(approved.body).toMatchObject({
      state: 'approved',
      requestedBy: `oaaccessmember${stamp}`,
      decidedBy: `oaaccessowner${stamp}`,
    });
    await rest(key).expect(200);
    await git(key).expect(200);
    const listed = await api()
      .get(`/api/organizations/${org}/oauth-app-access`)
      .set('cookie', owner.cookie)
      .expect(200);
    expect(listed.body).toMatchObject({
      restricted: true,
      apps: [
        {
          clientId: thirdParty,
          name: 'Tool',
          state: 'approved',
          owner: `oaaccessdev${stamp}`,
          homepageUrl: 'https://tool.example',
          scopes: ['read:org', 'repo'],
        },
      ],
    });

    // asking again leaves the answer as it is
    await api()
      .post(`/api/organizations/${org}/oauth-app-access/${thirdParty}/request`)
      .set('cookie', member.cookie)
      .expect(201)
      .expect((response) => expect(response.body.state).toBe('approved'));

    await api()
      .delete(`/api/organizations/${org}/oauth-app-access/${thirdParty}`)
      .set('cookie', owner.cookie)
      .expect(204);
    await rest(key).expect(404);

    await api()
      .put(`/api/organizations/${org}/oauth-app-access/${thirdParty}`)
      .set('cookie', owner.cookie)
      .send({ state: 'denied' })
      .expect(200);
    await rest(key).expect(404);
    await api()
      .put(`/api/organizations/${org}/oauth-app-access/nope`)
      .set('cookie', owner.cookie)
      .send({ state: 'approved' })
      .expect(404);
    await api()
      .put(`/api/organizations/${org}/oauth-app-access/${thirdParty}`)
      .set('cookie', owner.cookie)
      .send({ state: 'maybe' })
      .expect(400);
  });

  it('tells a member where an app reaches among their organizations', async () => {
    const { body } = await api()
      .get(`/api/oauth-apps/${thirdParty}/organizations`)
      .set('cookie', member.cookie)
      .expect(200);
    expect(body.organizations).toEqual([
      {
        slug: org,
        name: 'Access Org',
        restricted: true,
        allowed: false,
        state: 'denied',
      },
    ]);

    await restrict(false);
    const open = await api()
      .get(`/api/oauth-apps/${thirdParty}/organizations`)
      .set('cookie', member.cookie)
      .expect(200);
    expect(open.body.organizations[0]).toMatchObject({
      restricted: false,
      allowed: true,
    });
    await rest(await appKey(member.userId, thirdParty)).expect(200);
    await api()
      .get('/api/oauth-apps/nope/organizations')
      .set('cookie', member.cookie)
      .expect(404);
  });
});
