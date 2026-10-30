import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { type Database, schema } from '@ghost/db';
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import {
  generateUserToken,
  hashUserToken,
} from '../src/lib/apps/user-token.js';
import { hasBackends, signUp, startApp } from './harness.js';

const FORBIDDEN = 'Resource not accessible by integration';

describe.skipIf(!hasBackends)('What a ghu_ token may reach', () => {
  let app: INestApplication;
  let db: Database;
  let origin: string;
  let work: string;
  let appOwner: { cookie: string; key: string; userId: string };
  let alice: { cookie: string; key: string; userId: string };
  let bob: { cookie: string; key: string; userId: string };
  let carol: { cookie: string; key: string; userId: string };
  const stamp = Date.now();
  const aliceName = `ghualice${stamp}`;
  const r1 = `ghur1${stamp}`;
  const r2 = `ghur2${stamp}`;
  const pub = `ghupub${stamp}`;
  let apps = 0;
  let appId: string;
  let installationId: string;
  let aliceToken: string;
  let bobToken: string;
  let carolToken: string;
  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => api().get(url).set('authorization', `token ${token}`),
    post: (url: string, body: object = {}) =>
      api().post(url).set('authorization', `token ${token}`).send(body),
    patch: (url: string, body: object = {}) =>
      api().patch(url).set('authorization', `token ${token}`).send(body),
  });
  const createRepository = (
    cookie: string,
    name: string,
    visibility = 'private',
  ) =>
    api()
      .post('/api/repositories')
      .set('cookie', cookie)
      .send({ name, visibility })
      .expect(201);
  const repositoryId = async (slug: string) =>
    (
      await db
        .select({ id: schema.repository.id })
        .from(schema.repository)
        .where(eq(schema.repository.slug, slug))
    )[0]!.id;
  const registerApp = async () => {
    const { body } = await api()
      .post('/api/apps')
      .set('cookie', appOwner.cookie)
      .send({
        name: `User Perms ${stamp} ${apps++}`,
        homepageUrl: 'https://tool.example',
        permissions: { issues: 'write', contents: 'read' },
        events: [],
      })
      .expect(201);
    return body as { id: string; slug: string };
  };
  /** A token the OAuth flows would have minted; those are tested in github-app-user-tokens. */
  const tokenFor = async (forApp: string, userId: string) => {
    const token = generateUserToken();
    await db.insert(schema.appUserToken).values({
      appId: forApp,
      userId,
      tokenHash: hashUserToken(token),
    });
    return token;
  };
  const git = (cwd: string, ...args: string[]) =>
    promisify(execFile)(
      'git',
      ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
      { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
  const remote = (credential: string, repo: string) =>
    `${origin.replace('://', `://x-access-token:${credential}@`)}/${aliceName}/${repo}.git`;

  beforeAll(async () => {
    ({ app, origin } = await startApp());
    db = app.get<Database>(DATABASE);
    appOwner = await signUp(app, `ghuappowner${stamp}`);
    alice = await signUp(app, aliceName);
    bob = await signUp(app, `ghubob${stamp}`);
    carol = await signUp(app, `ghucarol${stamp}`);
    for (const name of [r1, r2]) await createRepository(alice.cookie, name);
    await createRepository(alice.cookie, pub, 'public');
    await db.insert(schema.repositoryCollaborator).values({
      repositoryId: await repositoryId(r1),
      userId: bob.userId,
      role: 'read',
      acceptedAt: new Date(),
    });

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-ghu-'));
    const seed = path.join(work, 'seed');
    execFileSync('git', ['init', '-q', '-b', 'main', seed]);
    writeFileSync(path.join(seed, 'a.txt'), 'one\n');
    await git(seed, 'add', '.');
    await git(seed, 'commit', '-q', '-m', 'first');
    await git(
      seed,
      'push',
      '-q',
      `${origin.replace('://', `://${aliceName}:${alice.key}@`)}/${aliceName}/${r1}.git`,
      'main',
    );

    const registered = await registerApp();
    appId = registered.id;
    const { body: installation } = await api()
      .post(`/api/apps/${registered.slug}/installations`)
      .set('cookie', alice.cookie)
      .send({
        account: aliceName,
        repositorySelection: 'selected',
        repositoryIds: [await repositoryId(r1)],
      })
      .expect(201);
    installationId = installation.id;
    aliceToken = await tokenFor(appId, alice.userId);
    bobToken = await tokenFor(appId, bob.userId);
    carolToken = await tokenFor(appId, carol.userId);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it("alice's token reads and writes issues on r1, as alice", async () => {
    const { body } = await as(aliceToken)
      .post(`/api/v3/repos/${aliceName}/${r1}/issues`, {
        title: 'From the app',
      })
      .expect(201);
    expect(body.user.login).toBe(aliceName);
    await as(aliceToken)
      .get(`/api/v3/repos/${aliceName}/${r1}/issues/${body.number}`)
      .expect(200);
  });

  it('is refused contents write on r1', async () => {
    const { body } = await as(aliceToken)
      .post(`/api/v3/repos/${aliceName}/${r1}/releases`, { tag_name: 'v1' })
      .expect(403);
    expect(body.message).toBe(FORBIDDEN);
  });

  it("bob's token reads r1 issues but cannot close alice's issue (his role)", async () => {
    const { body: issue } = await as(aliceToken)
      .post(`/api/v3/repos/${aliceName}/${r1}/issues`, { title: 'Bob reads' })
      .expect(201);
    await as(bobToken)
      .get(`/api/v3/repos/${aliceName}/${r1}/issues/${issue.number}`)
      .expect(200);
    const closed = await as(bobToken).patch(
      `/api/v3/repos/${aliceName}/${r1}/issues/${issue.number}`,
      { state: 'closed' },
    );
    expect([403, 404]).toContain(closed.status);
  });

  it('does not reach a private repository the user cannot see', async () => {
    await as(carolToken)
      .get(`/api/v3/repos/${aliceName}/${r1}/issues`)
      .expect(404);
  });

  it("answers 404 on alice's private r2 outside the installation, and reads a public repository outside it as the user", async () => {
    await as(aliceToken)
      .get(`/api/v3/repos/${aliceName}/${r2}/issues`)
      .expect(404);
    await as(carolToken)
      .get(`/api/v3/repos/${aliceName}/${pub}/issues`)
      .expect(200);
  });

  it('reads /user without any installation', async () => {
    const { body } = await as(carolToken).get('/api/v3/user').expect(200);
    expect(body.login).toBe(`ghucarol${stamp}`);
  });

  it("is refused on Ghost's own API (401) and on GraphQL (403)", async () => {
    await api()
      .get('/api/notifications')
      .set('authorization', `Bearer ${aliceToken}`)
      .expect(401);
    const { body } = await api()
      .post('/api/graphql')
      .set('authorization', `token ${aliceToken}`)
      .send({ query: '{ viewer { login } }' })
      .expect(403);
    expect(body.message).toBe(FORBIDDEN);
  });

  it('clones r1 over git with the token as password and is refused a push without contents write', async () => {
    const clone = path.join(work, 'clone');
    await git(work, 'clone', '-q', remote(aliceToken, r1), clone);
    writeFileSync(path.join(clone, 'b.txt'), 'two\n');
    await git(clone, 'add', '.');
    await git(clone, 'commit', '-q', '-m', 'second');
    await expect(git(clone, 'push', '-q', 'origin', 'main')).rejects.toThrow(
      /403/,
    );
  });

  it('loses access when the installation is suspended, and regains it when unsuspended', async () => {
    const issues = `/api/v3/repos/${aliceName}/${r1}/issues`;
    await api()
      .put(`/api/installations/${installationId}/suspended`)
      .set('cookie', alice.cookie)
      .expect(204);
    await as(aliceToken).get(issues).expect(404);
    await api()
      .delete(`/api/installations/${installationId}/suspended`)
      .set('cookie', alice.cookie)
      .expect(204);
    await as(aliceToken).get(issues).expect(200);
  });

  it('stops at once when the app is deleted', async () => {
    const other = await registerApp();
    const token = await tokenFor(other.id, alice.userId);
    await as(token).get('/api/v3/user').expect(200);
    await api()
      .delete(`/api/apps/${other.slug}`)
      .set('cookie', appOwner.cookie)
      .expect(204);
    await as(token).get('/api/v3/user').expect(401);
  });

  it('loses repository access when the app is uninstalled, and keeps /user', async () => {
    await api()
      .delete(`/api/installations/${installationId}`)
      .set('cookie', alice.cookie)
      .expect(204);
    await as(aliceToken)
      .get(`/api/v3/repos/${aliceName}/${r1}/issues`)
      .expect(404);
    await as(aliceToken).get('/api/v3/user').expect(200);
  });
});
