import { createHash } from 'node:crypto';

import { type Database, schema } from '@ghost/db';
import type { INestApplication } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import { hasBackends, signUp, startApp } from './harness.js';

const CALLBACK = 'https://tool.example/oauth/callback';

describe.skipIf(!hasBackends)('GitHub OAuth web flow', () => {
  let app: INestApplication;
  let owner: { cookie: string; key: string; userId: string };
  const username = `ghweb${Date.now()}`;
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

  const codeFor = async (query: Record<string, string> = {}) => {
    const consent = await follow({ client_id: clientId, scope: 'repo', ...query });
    const callback = consent.searchParams.has('sig') ? await decide(consent, true) : consent;
    return callback.searchParams.get('code') as string;
  };
  const exchange = (body: Record<string, string>, accept = 'application/x-www-form-urlencoded') => api().post('/login/oauth/access_token').set('accept', accept).type('form').send({ client_id: clientId, client_secret: clientSecret, ...body }).expect(200);
  const form = (text: string) => Object.fromEntries(new URLSearchParams(text));

  beforeAll(async () => {
    ({ app } = await startApp({ WEB_APP_URL: 'https://web.example' }));
    owner = await signUp(app, username);
    const created = await api().post('/api/oauth-apps').set('cookie', owner.cookie).send({ name: 'Web Tool', homepageUrl: 'https://tool.example', callbackUrls: [CALLBACK] }).expect(201);
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

  it('accepts a redirect_uri under any registered callback, and sends users to the first by default', async () => {
    const created = await api().post('/api/oauth-apps').set('cookie', owner.cookie).send({ name: 'Two Callbacks', homepageUrl: 'https://tool.example', callbackUrls: [CALLBACK, 'http://localhost:4000/cb'] }).expect(201);
    const local = await follow({ client_id: created.body.clientId, redirect_uri: 'http://localhost:4000/cb/next', scope: 'repo' });
    expect(`${(await decide(local, true)).origin}`).toBe('http://localhost:4000');
    const fallback = await follow({ client_id: created.body.clientId, scope: 'gist' });
    const callback = await decide(fallback, true);
    expect(`${callback.origin}${callback.pathname}`).toBe(CALLBACK);
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
    expect(response.body).toEqual({ clientId, name: 'Web Tool', description: null, homepageUrl: 'https://tool.example', logoUrl: null, owner: expect.stringMatching(/^ghweb/), verified: false });
    const gh = await api().get('/api/oauth-apps/authorize').query({ client_id: '178c6fc778ccc68e1d6a' }).set('cookie', owner.cookie).expect(200);
    expect(gh.body).toEqual({ clientId: '178c6fc778ccc68e1d6a', name: 'GitHub CLI', description: null, homepageUrl: 'https://cli.github.com', logoUrl: null, owner: null, verified: true });
    await api().get('/api/oauth-apps/authorize').query({ client_id: 'nope' }).set('cookie', owner.cookie).expect(404);
  });

  it('exchanges a code for a ghost_pat_ key with the approved scopes, form-encoded by default', async () => {
    const code = await codeFor({ scope: 'repo read:org' });
    const response = await exchange({ code });
    expect(response.headers['content-type']).toMatch(/application\/x-www-form-urlencoded/);
    const token = form(response.text);
    expect(token).toMatchObject({ token_type: 'bearer', scope: 'repo,read:org' });
    expect(token.access_token).toMatch(/^ghost_pat_/);
    const user = await api().get('/api/v3/user').set('authorization', `token ${token.access_token}`).expect(200);
    expect(user.headers['x-oauth-scopes']).toBe('repo, read:org');
    expect(user.body.login).toBe(username);
    await api().get('/api/notifications').set('authorization', `Bearer ${token.access_token}`).expect(401);
    const live = await app.get<Database>(DATABASE).select({ id: schema.oauthAccessToken.id }).from(schema.oauthAccessToken).where(and(eq(schema.oauthAccessToken.clientId, clientId), isNull(schema.oauthAccessToken.revoked)));
    expect(live).toEqual([]);
  });

  it('answers JSON when asked', async () => {
    const response = await exchange({ code: await codeFor() }, 'application/json');
    expect(response.body).toMatchObject({ token_type: 'bearer', scope: 'repo' });
    expect(response.body.access_token).toMatch(/^ghost_pat_/);
  });

  it('mints a key with no scope when the app asked for none', async () => {
    const token = form((await exchange({ code: await codeFor({ scope: '' }) })).text);
    expect(token.scope).toBe('');
    const user = await api().get('/api/v3/user').set('authorization', `token ${token.access_token}`).expect(200);
    expect(user.headers['x-oauth-scopes']).toBe('');
  });

  it('yields a key for a code only once', async () => {
    const code = await codeFor();
    expect(form((await exchange({ code })).text).access_token).toMatch(/^ghost_pat_/);
    expect(form((await exchange({ code })).text)).toMatchObject({ error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' });
  });

  it('refuses a wrong secret, and the secret a rotation replaced', async () => {
    expect(form((await exchange({ code: await codeFor(), client_secret: 'wrong' })).text)).toMatchObject({ error: 'incorrect_client_credentials', error_description: 'The client_id and/or client_secret passed are incorrect.' });
    const other = await api().post('/api/oauth-apps').set('cookie', owner.cookie).send({ name: 'Rotating', homepageUrl: 'https://tool.example', callbackUrls: [CALLBACK] }).expect(201);
    const rotated = await api().post(`/api/oauth-apps/${other.body.clientId}/secret`).set('cookie', owner.cookie).expect(201);
    const consent = await follow({ client_id: other.body.clientId, scope: 'repo' });
    const code = (await decide(consent, true)).searchParams.get('code') as string;
    const stale = await exchange({ client_id: other.body.clientId, client_secret: other.body.clientSecret, code });
    expect(form(stale.text)).toMatchObject({ error: 'incorrect_client_credentials', error_description: 'The client_id and/or client_secret passed are incorrect.' });
    const again = (await decide(await follow({ client_id: other.body.clientId, scope: 'gist' }), true)).searchParams.get('code') as string;
    const fresh = await exchange({ client_id: other.body.clientId, client_secret: rotated.body.clientSecret, code: again });
    expect(form(fresh.text).access_token).toMatch(/^ghost_pat_/);
  });

  it("refuses a code presented with another app's credentials", async () => {
    const code = await codeFor();
    const other = await api().post('/api/oauth-apps').set('cookie', owner.cookie).send({ name: 'Other', homepageUrl: 'https://tool.example', callbackUrls: [CALLBACK] }).expect(201);
    const response = await exchange({ client_id: other.body.clientId, client_secret: other.body.clientSecret, code });
    expect(form(response.text).access_token).toBeUndefined();
    expect(form(response.text).error).toBeTruthy();
  });

  it('refuses an unknown client and a redirect_uri outside the callback', async () => {
    expect(form((await exchange({ client_id: 'nope', code: 'x' })).text)).toMatchObject({ error: 'incorrect_client_credentials', error_description: 'The client_id and/or client_secret passed are incorrect.' });
    expect(form((await exchange({ code: await codeFor(), redirect_uri: 'https://evil.example/cb' })).text)).toMatchObject({ error: 'redirect_uri_mismatch', error_description: 'The redirect_uri MUST match the registered callback URL for this application.' });
  });

  it('refuses an expired code', async () => {
    const code = await codeFor();
    const db = app.get<Database>(DATABASE);
    // The plugin stores a code as its SHA-256, base64url.
    const expired = await db.update(schema.verification).set({ expiresAt: new Date(0) }).where(eq(schema.verification.identifier, createHash('sha256').update(code).digest('base64url'))).returning({ id: schema.verification.id });
    expect(expired).toHaveLength(1);
    expect(form((await exchange({ code })).text)).toMatchObject({ error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' });
  });

  it('checks the PKCE verifier against the S256 challenge', async () => {
    const verifier = 'a'.repeat(64);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const wrong = await codeFor({ code_challenge: challenge, code_challenge_method: 'S256' });
    expect(form((await exchange({ code: wrong, code_verifier: 'b'.repeat(64) })).text)).toMatchObject({ error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' });
    const right = await codeFor({ code_challenge: challenge, code_challenge_method: 'S256' });
    expect(form((await exchange({ code: right, code_verifier: verifier })).text).access_token).toMatch(/^ghost_pat_/);
  });

  it('answers a request with neither a device code nor a code with unsupported_grant_type', async () => {
    const response = await api().post('/login/oauth/access_token').type('form').send({ client_id: clientId }).expect(400);
    expect(form(response.text)).toMatchObject({ error: 'unsupported_grant_type', error_description: 'Send a code, a device_code with the device grant_type, or a refresh_token with grant_type=refresh_token.' });
  });
});
