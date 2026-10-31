import type { INestApplication } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Auth } from '../src/lib/auth.js';
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

  it('describes a Ghost App on the consent page by its owner, not as built into Ghost', async () => {
    const client = await register();
    const { body } = await api()
      .get('/api/oauth-apps/authorize')
      .query({ client_id: client.clientId })
      .set('cookie', owner.cookie)
      .expect(200);
    expect(body).toMatchObject({
      clientId: client.clientId,
      owner: `ghuowner${stamp}`,
      ghostApp: { slug: client.slug },
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

  describe('installations and token management', () => {
    let other: { cookie: string; key: string; userId: string };
    const org = `ghuorg${stamp}`;
    const basic = (clientId: string, secret: string) =>
      `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`;
    const repository = (cookie: string, name: string) =>
      api()
        .post('/api/repositories')
        .set('cookie', cookie)
        .send({ name, visibility: 'private' })
        .expect(201)
        .then(() => name);
    const install = (slug: string, cookie: string, account: string) =>
      api()
        .post(`/api/apps/${slug}/installations`)
        .set('cookie', cookie)
        .send({ account, repositorySelection: 'all' })
        .expect(201)
        .then(({ body }) => body as { id: string; installationId: number });

    beforeAll(async () => {
      other = await signUp(app, `ghuother${stamp}`);
      await app.get<AuthService<Auth>>(AuthService).api.createOrganization({
        body: { name: 'User Token Org', slug: org },
        headers: new Headers({ cookie: owner.cookie }),
      });
      await repository(owner.cookie, `ghumine${stamp}`);
      await repository(owner.cookie, `ghuminetoo${stamp}`);
      await repository(other.cookie, `ghutheirs${stamp}`);
    });

    it('lists the installations the user can access', async () => {
      const client = await register();
      const mine = await install(client.slug, owner.cookie, `ghuowner${stamp}`);
      const theirs = await install(
        client.slug,
        other.cookie,
        `ghuother${stamp}`,
      );
      const { access_token } = await webFlow(client);

      const { body } = await api()
        .get('/api/v3/user/installations')
        .set('authorization', `token ${access_token}`)
        .expect(200);
      const ids = body.installations.map((each: { id: number }) => each.id);
      expect(ids).toContain(mine.installationId);
      expect(ids).not.toContain(theirs.installationId);
      expect(body.total_count).toBe(ids.length);

      const repos = await api()
        .get(`/api/v3/user/installations/${mine.installationId}/repositories`)
        .set('authorization', `token ${access_token}`)
        .expect(200);
      expect(
        repos.body.repositories.map((each: { name: string }) => each.name),
      ).toContain(`ghumine${stamp}`);
      expect(repos.body).toMatchObject({
        total_count: repos.body.repositories.length,
        repository_selection: 'all',
      });
      await api()
        .get(`/api/v3/user/installations/${theirs.installationId}/repositories`)
        .set('authorization', `token ${access_token}`)
        .expect(404);
    });

    it('does not list an installation only because its repository is public, as GitHub needs explicit access', async () => {
      const client = await register();
      await api()
        .post('/api/repositories')
        .set('cookie', other.cookie)
        .send({ name: `ghupublic${stamp}`, visibility: 'public' })
        .expect(201);
      const theirs = await api()
        .post(`/api/apps/${client.slug}/installations`)
        .set('cookie', other.cookie)
        .send({ account: `ghuother${stamp}`, repositorySelection: 'all' })
        .expect(201);
      const { access_token } = await webFlow(client);
      const { body } = await api()
        .get('/api/v3/user/installations')
        .set('authorization', `token ${access_token}`)
        .expect(200);
      expect(
        body.installations.map((each: { id: number }) => each.id),
      ).not.toContain(theirs.body.installationId);
      await api()
        .get(
          `/api/v3/user/installations/${theirs.body.installationId}/repositories`,
        )
        .set('authorization', `token ${access_token}`)
        .expect(404);
    });

    it('refuses /user/installations to a PAT', async () => {
      const { body } = await api()
        .get('/api/v3/user/installations')
        .set('authorization', `token ${owner.key}`)
        .expect(403);
      expect(body.message).toBe(
        'You must authenticate with an access token authorized to a GitHub App in order to list installations',
      );
    });

    it("checks a token with the app's credentials", async () => {
      const client = await register();
      const { access_token } = await webFlow(client);
      const { body } = await api()
        .post(`/api/v3/applications/${client.clientId}/token`)
        .set('authorization', basic(client.clientId, client.clientSecret))
        .send({ access_token })
        .expect(200);
      expect(body).toMatchObject({
        token: access_token,
        token_last_eight: access_token.slice(-8),
        scopes: [],
        expires_at: expect.any(String),
        user: { login: `ghuowner${stamp}` },
        app: { client_id: client.clientId },
      });
    });

    it("refuses another app's token and bad credentials, and the token keeps working", async () => {
      const mine = await register();
      const theirs = await register();
      const { access_token } = await webFlow(theirs);
      await api()
        .post(`/api/v3/applications/${mine.clientId}/token`)
        .set('authorization', basic(mine.clientId, mine.clientSecret))
        .send({ access_token })
        .expect(404);
      await api()
        .post(`/api/v3/applications/${theirs.clientId}/token`)
        .set('authorization', basic(theirs.clientId, 'ghost_cs_wrong'))
        .send({ access_token })
        .expect(404);
      await api()
        .delete(`/api/v3/applications/${mine.clientId}/token`)
        .set('authorization', basic(mine.clientId, mine.clientSecret))
        .send({ access_token })
        .expect(404);
      await api()
        .get('/api/v3/user')
        .set('authorization', `token ${access_token}`)
        .expect(200);
    });

    it('revokes one token', async () => {
      const client = await register();
      const first = await webFlow(client);
      const second = await webFlow(client);
      await api()
        .delete(`/api/v3/applications/${client.clientId}/token`)
        .set('authorization', basic(client.clientId, client.clientSecret))
        .send({ access_token: first.access_token })
        .expect(204);
      await api()
        .get('/api/v3/user')
        .set('authorization', `token ${first.access_token}`)
        .expect(401);
      await api()
        .get('/api/v3/user')
        .set('authorization', `token ${second.access_token}`)
        .expect(200);
    });

    it('resetting swaps the token for a new one and revokes the old', async () => {
      const client = await register();
      const { access_token } = await webFlow(client);
      const { body } = await api()
        .patch(`/api/v3/applications/${client.clientId}/token`)
        .set('authorization', basic(client.clientId, client.clientSecret))
        .send({ access_token })
        .expect(200);
      expect(body).toMatchObject({
        token: expect.stringMatching(/^ghu_/),
        expires_at: expect.any(String),
        user: { login: `ghuowner${stamp}` },
        app: { client_id: client.clientId },
      });
      expect(body.token).not.toBe(access_token);
      await api()
        .get('/api/v3/user')
        .set('authorization', `token ${access_token}`)
        .expect(401);
      await api()
        .get('/api/v3/user')
        .set('authorization', `token ${body.token}`)
        .expect(200);
      await api()
        .patch(`/api/v3/applications/${client.clientId}/token`)
        .set('authorization', basic(client.clientId, client.clientSecret))
        .send({ access_token })
        .expect(404);
    });

    it('a scoped token reaches only the repositories and permissions it asked for', async () => {
      const client = await register();
      await install(client.slug, owner.cookie, `ghuowner${stamp}`);
      const { access_token } = await webFlow(client);
      const { body } = await api()
        .post(`/api/v3/applications/${client.clientId}/token/scoped`)
        .set('authorization', basic(client.clientId, client.clientSecret))
        .send({
          access_token,
          target: `ghuowner${stamp}`,
          repositories: [`ghumine${stamp}`],
          permissions: { issues: 'read' },
        })
        .expect(200);
      expect(body).toMatchObject({
        token: expect.stringMatching(/^ghu_/),
        user: { login: `ghuowner${stamp}` },
      });
      const issues = (repo: string, auth: string) =>
        api()
          .get(`/api/v3/repos/ghuowner${stamp}/${repo}/issues`)
          .set('authorization', `token ${auth}`);

      await issues(`ghumine${stamp}`, body.token).expect(200);
      await issues(`ghuminetoo${stamp}`, body.token).expect(404);
      await api()
        .post(`/api/v3/repos/ghuowner${stamp}/ghumine${stamp}/issues`)
        .set('authorization', `token ${body.token}`)
        .send({ title: 'scoped' })
        .expect(403);
      await issues(`ghuminetoo${stamp}`, access_token).expect(200);
    });

    it('refuses a scoped token wider than the original, or with repositories but no target', async () => {
      const client = await register();
      await install(client.slug, owner.cookie, `ghuowner${stamp}`);
      const { access_token } = await webFlow(client);
      const scoped = (body: object) =>
        api()
          .post(`/api/v3/applications/${client.clientId}/token/scoped`)
          .set('authorization', basic(client.clientId, client.clientSecret))
          .send({ access_token, ...body });

      await scoped({
        target: `ghuowner${stamp}`,
        permissions: { contents: 'write' },
      }).expect(422);
      await scoped({ repositories: [`ghumine${stamp}`] }).expect(422);
      await scoped({ target: `ghuother${stamp}` }).expect(422);
      const narrow = await scoped({
        target: `ghuowner${stamp}`,
        permissions: { issues: 'read' },
      }).expect(200);
      await api()
        .post(`/api/v3/applications/${client.clientId}/token/scoped`)
        .set('authorization', basic(client.clientId, client.clientSecret))
        .send({
          access_token: narrow.body.token,
          target: `ghuowner${stamp}`,
          permissions: { issues: 'write' },
        })
        .expect(422);
    });

    it('revoking the grant kills every token and refresh token of that user for the app', async () => {
      const client = await register();
      const first = await webFlow(client);
      const second = await webFlow(client);
      await api()
        .delete(`/api/v3/applications/${client.clientId}/grant`)
        .set('authorization', basic(client.clientId, client.clientSecret))
        .send({ access_token: first.access_token })
        .expect(204);
      for (const { access_token } of [first, second])
        await api()
          .get('/api/v3/user')
          .set('authorization', `token ${access_token}`)
          .expect(401);
      const refreshed = await token({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: second.refresh_token,
      });
      expect(refreshed.body.error).toBe('bad_refresh_token');
    });

    it('Authorized apps lists a Ghost App and revoking it kills its ghu_ and ghr_ tokens', async () => {
      const client = await register();
      const granted = await webFlow(client);
      const { body } = await api()
        .get('/api/oauth-apps/authorized')
        .set('cookie', owner.cookie)
        .expect(200);
      expect(
        body.apps.map((each: { clientId: string }) => each.clientId),
      ).toContain(client.clientId);

      await api()
        .delete(`/api/oauth-apps/authorized/${client.clientId}`)
        .set('cookie', owner.cookie)
        .expect(204);
      await api()
        .get('/api/v3/user')
        .set('authorization', `token ${granted.access_token}`)
        .expect(401);
      const refreshed = await token({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: granted.refresh_token,
      });
      expect(refreshed.body.error).toBe('bad_refresh_token');
    });
  });
});
