import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, signUp, startApp } from './harness.js';

const CALLBACK = 'https://tool.example/oauth/callback';

describe.skipIf(!hasBackends)('GitHub OAuth web flow', () => {
  let app: INestApplication;
  let owner: { cookie: string; key: string; userId: string };
  let clientId: string;
  let clientSecret: string;
  const api = () => request(app.getHttpServer());
  const authorize = (query: Record<string, string>, cookie = owner.cookie) => api().get('/login/oauth/authorize').query(query).set('cookie', cookie);
  const follow = async (query: Record<string, string>, cookie = owner.cookie) => {
    const first = await authorize(query, cookie).expect(302);
    const plugin = new URL(first.headers.location, 'http://api.local');
    expect(plugin.pathname).toBe('/api/auth/oauth2/authorize');
    const second = await api().get(`${plugin.pathname}${plugin.search}`).set('cookie', cookie).expect(302);
    return new URL(second.headers.location);
  };
  const decide = async (consent: URL, accept: boolean) => {
    const response = await api().post('/api/auth/oauth2/consent').set('cookie', owner.cookie).send({ accept, oauth_query: consent.search.slice(1) }).expect(200);
    return new URL(response.body.url);
  };

  beforeAll(async () => {
    ({ app } = await startApp({ WEB_APP_URL: 'https://web.example' }));
    owner = await signUp(app, `ghweb${Date.now()}`);
    const created = await api().post('/api/oauth-apps').set('cookie', owner.cookie).send({ name: 'Web Tool', homepageUrl: 'https://tool.example', callbackUrl: CALLBACK }).expect(201);
    ({ clientId, clientSecret } = created.body);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('answers an unknown client with an error page and never redirects', async () => {
    const response = await authorize({ client_id: 'nope', redirect_uri: CALLBACK }).expect(400);
    expect(response.headers.location).toBeUndefined();
    expect(response.headers['content-type']).toMatch(/text\/html/);
  });

  it.each([
    ['another host', 'https://evil.example/oauth/callback'],
    ['another port', 'https://tool.example:8443/oauth/callback'],
    ['a path outside the callback', 'https://tool.example/elsewhere'],
  ])('answers a redirect_uri on %s with an error page and never redirects', async (_, redirectUri) => {
    const response = await authorize({ client_id: clientId, redirect_uri: redirectUri }).expect(400);
    expect(response.headers.location).toBeUndefined();
  });

  it('sends the user to the consent page with only the scopes Ghost knows', async () => {
    const consent = await follow({ client_id: clientId, scope: 'repo bogus read:org', state: 'abc' });
    expect(`${consent.origin}${consent.pathname}`).toBe('https://web.example/login/oauth/authorize');
    expect(consent.searchParams.get('client_id')).toBe(clientId);
    expect(consent.searchParams.get('scope')).toBe('repo read:org');
  });

  it('asks for no scope when none is requested, rather than every scope', async () => {
    const consent = await follow({ client_id: clientId, scope: 'bogus' });
    expect(consent.searchParams.get('scope')).toBe('public');
  });

  it('redirects to a path under the callback with a code and the state', async () => {
    const consent = await follow({ client_id: clientId, redirect_uri: `${CALLBACK}/sub`, scope: 'gist', state: 'xyz' });
    const callback = await decide(consent, true);
    expect(`${callback.origin}${callback.pathname}`).toBe(`${CALLBACK}/sub`);
    expect(callback.searchParams.get('code')).toBeTruthy();
    expect(callback.searchParams.get('state')).toBe('xyz');
  });

  it('carries access_denied and the state back on deny', async () => {
    const consent = await follow({ client_id: clientId, scope: 'user', state: 'no' });
    const callback = await decide(consent, false);
    expect(callback.searchParams.get('error')).toBe('access_denied');
    expect(callback.searchParams.get('state')).toBe('no');
  });

  it('skips the consent page once the same scopes were approved', async () => {
    await decide(await follow({ client_id: clientId, scope: 'read:org' }), true);
    const again = await follow({ client_id: clientId, scope: 'read:org', state: 's2' });
    expect(`${again.origin}${again.pathname}`).toBe(CALLBACK);
    expect(again.searchParams.get('code')).toBeTruthy();
    expect(again.searchParams.get('state')).toBe('s2');
  });

  it('sends a signed-out user to the same page to sign in first', async () => {
    const consent = await follow({ client_id: clientId, scope: 'repo' }, '');
    expect(`${consent.origin}${consent.pathname}`).toBe('https://web.example/login/oauth/authorize');
  });

  it('keeps the client secret out of every redirect', async () => {
    const consent = await follow({ client_id: clientId, scope: 'repo' });
    expect(consent.href).not.toContain(clientSecret);
  });

  it('describes the app to the consent page: name, homepage and owner, never the secret', async () => {
    const response = await api().get('/api/oauth-apps/authorize').query({ client_id: clientId }).set('cookie', owner.cookie).expect(200);
    expect(response.body).toEqual({ clientId, name: 'Web Tool', homepageUrl: 'https://tool.example', owner: expect.stringMatching(/^ghweb/) });
    const gh = await api().get('/api/oauth-apps/authorize').query({ client_id: '178c6fc778ccc68e1d6a' }).set('cookie', owner.cookie).expect(200);
    expect(gh.body).toEqual({ clientId: '178c6fc778ccc68e1d6a', name: 'GitHub CLI', homepageUrl: 'https://cli.github.com', owner: null });
    await api().get('/api/oauth-apps/authorize').query({ client_id: 'nope' }).set('cookie', owner.cookie).expect(404);
  });
});
