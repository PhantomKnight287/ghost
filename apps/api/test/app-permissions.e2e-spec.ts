import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { type Database, schema } from '@ghost/db';
import { App } from '@octokit/app';
import { Octokit } from '@octokit/core';
import type { INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { GraphQLSchemaHost } from '@nestjs/graphql';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { eq } from 'drizzle-orm';
import { GraphQLObjectType } from 'graphql';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import { APP_PERMISSION } from '../src/lib/apps/app-permission.js';
import {
  GRAPHQL_ROOT_PERMISSIONS,
  GRAPHQL_TYPE_PERMISSIONS,
} from '../src/lib/apps/graphql-permissions.js';
import type { Auth } from '../src/lib/auth.js';
import { hasBackends, signUp, startApp } from './harness.js';

const FORBIDDEN = 'Resource not accessible by integration';
const LFS = 'application/vnd.git-lfs+json';

/** Routes an installation token is refused on purpose: JWT-only, user-only, and repository administration. Adding a GitHub-compatible route means declaring its permission or listing it here. */
const DENIED_TO_INSTALLATIONS = [
  'GET v3/app',
  'GET v3/app/installations',
  'GET v3/app/installations/:installation_id',
  'DELETE v3/app/installations/:installation_id',
  'POST v3/app/installations/:installation_id/access_tokens',
  'GET v3/repos/:owner/:repo/installation',
  'GET v3/orgs/:org/installation',
  'GET v3/users/:username/installation',
  'GET v3/user',
  'GET v3/user/installations',
  'GET v3/user/installations/:installation_id/repositories',
  'POST v3/applications/:client_id/token',
  'PATCH v3/applications/:client_id/token',
  'POST v3/applications/:client_id/token/scoped',
  'DELETE v3/applications/:client_id/token',
  'DELETE v3/applications/:client_id/grant',
  'GET v3/user/keys',
  'POST v3/user/keys',
  'GET v3/user/ssh_signing_keys',
  'GET v3/user/ssh_signing_keys/:id',
  'POST v3/user/ssh_signing_keys',
  'DELETE v3/user/ssh_signing_keys/:id',
  'GET v3/user/repos',
  'POST v3/user/repos',
  'GET v3/users/:username/repos',
  'GET v3/orgs/:org/repos',
  'POST v3/orgs/:org/repos',
  'PATCH v3/repos/:owner/:repo',
  'DELETE v3/repos/:owner/:repo',
  'POST v3/repos/:owner/:repo/rulesets',
  'GET v3/repos/:owner/:repo/rulesets/rule-suites',
  'GET v3/repos/:owner/:repo/rulesets/rule-suites/:id',
  'PUT v3/repos/:owner/:repo/rulesets/:id',
  'DELETE v3/repos/:owner/:repo/rulesets/:id',
  'POST uploads/user-attachments/assets',
];

/** GraphQL root fields an installation token is refused on purpose. */
const GRAPHQL_DENIED_TO_INSTALLATIONS = ['Mutation.createRepository'];

const join = (...parts: string[]) =>
  parts
    .flatMap((part) => part.split('/'))
    .filter(Boolean)
    .join('/');

describe.skipIf(!hasBackends)('App permissions on installation tokens', () => {
  let app: INestApplication;
  let db: Database;
  let origin: string;
  let work: string;
  let appOwner: { cookie: string; key: string; userId: string };
  let installer: { cookie: string; key: string; userId: string };
  let other: { cookie: string; key: string; userId: string };
  const stamp = Date.now();
  const installerName = `apinstaller${stamp}`;
  const otherName = `apother${stamp}`;
  const org = `aporg${stamp}`;
  const r1 = `apr1${stamp}`;
  const r2 = `apr2${stamp}`;
  const moved = `apmoved${stamp}`;
  const pub = `appub${stamp}`;
  const o1 = `apo1${stamp}`;
  let apps = 0;
  let token: string;
  let narrowToken: string;
  let botLogin: string;
  const api = () => request(app.getHttpServer());
  const auth = () => app.get<AuthService<Auth>>(AuthService).api;
  const as = (credential: string) => ({
    get: (url: string) =>
      api().get(url).set('authorization', `token ${credential}`),
    post: (url: string, body: object = {}) =>
      api().post(url).set('authorization', `token ${credential}`).send(body),
    patch: (url: string, body: object = {}) =>
      api().patch(url).set('authorization', `token ${credential}`).send(body),
  });
  const repositoryId = async (slug: string) =>
    (
      await db
        .select({ id: schema.repository.id })
        .from(schema.repository)
        .where(eq(schema.repository.slug, slug))
    )[0]!.id;
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
  /** An app with `permissions`, installed on each account in `installs`. */
  const installedApp = async (
    permissions: Record<string, string>,
    installs: {
      cookie: string;
      account: string;
      repositories?: string[];
    }[],
  ) => {
    const { body } = await api()
      .post('/api/apps')
      .set('cookie', appOwner.cookie)
      .send({
        name: `Perms ${stamp} ${apps++}`,
        homepageUrl: 'https://bot.example',
        permissions,
        events: [],
      })
      .expect(201);
    const { body: key } = await api()
      .post(`/api/apps/${body.slug}/private-keys`)
      .set('cookie', appOwner.cookie)
      .expect(201);
    const installationIds: number[] = [];
    for (const install of installs) {
      const { body: installation } = await api()
        .post(`/api/apps/${body.slug}/installations`)
        .set('cookie', install.cookie)
        .send({
          account: install.account,
          ...(install.repositories
            ? {
                repositorySelection: 'selected',
                repositoryIds: await Promise.all(
                  install.repositories.map(repositoryId),
                ),
              }
            : { repositorySelection: 'all' }),
        })
        .expect(201);
      installationIds.push(installation.installationId);
    }
    const octokitApp = new App({
      appId: body.appId,
      privateKey: key.privateKey,
      Octokit: Octokit.defaults({ baseUrl: `${origin}/api/v3` }),
    });
    const mint = async (
      installationId = installationIds[0]!,
      narrowing: object = {},
    ) =>
      (
        await octokitApp.octokit.request(
          'POST /app/installations/{installation_id}/access_tokens',
          { installation_id: installationId, ...narrowing },
        )
      ).data.token;
    return { botLogin: body.botLogin as string, mint };
  };
  const git = (cwd: string, ...args: string[]) =>
    promisify(execFile)(
      'git',
      ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
      { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
  const remote = (credential: string, owner: string, repo: string) =>
    `${origin.replace('://', `://x-access-token:${credential}@`)}/${owner}/${repo}.git`;

  beforeAll(async () => {
    ({ app, origin } = await startApp());
    db = app.get<Database>(DATABASE);
    appOwner = await signUp(app, `apowner${stamp}`);
    installer = await signUp(app, installerName);
    other = await signUp(app, otherName);
    await auth().createOrganization({
      body: { name: 'Perms Org', slug: org },
      headers: new Headers({ cookie: installer.cookie }),
    });
    for (const name of [r1, r2, moved])
      await createRepository(installer.cookie, name);
    await createRepository(installer.cookie, pub, 'public');
    await createRepository(other.cookie, o1);

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-app-permissions-'));
    const seed = path.join(work, 'seed');
    execFileSync('git', ['init', '-q', '-b', 'main', seed]);
    writeFileSync(path.join(seed, 'a.txt'), 'one\n');
    await git(seed, 'add', '.');
    await git(seed, 'commit', '-q', '-m', 'first');
    for (const repo of [r1, r2, moved])
      await git(
        seed,
        'push',
        '-q',
        `${origin.replace('://', `://${installerName}:${installer.key}@`)}/${installerName}/${repo}.git`,
        'main',
      );

    const tokens = await installedApp({ issues: 'write', contents: 'read' }, [
      {
        cookie: installer.cookie,
        account: installerName,
        repositories: [r1, moved],
      },
      { cookie: other.cookie, account: otherName },
    ]);
    botLogin = tokens.botLogin;
    token = await tokens.mint();
    narrowToken = await tokens.mint(undefined, {
      permissions: { issues: 'read' },
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('every route is declared or denied on purpose', () => {
    const routes: { route: string; declared: boolean }[] = [];
    for (const module of app.get(ModulesContainer).values())
      for (const wrapper of module.controllers.values()) {
        const controller = wrapper.metatype as (new () => object) | null;
        if (!controller) continue;
        const base: string = Reflect.getMetadata(PATH_METADATA, controller);
        if (!/^(?:v3|uploads|:username\/:repo)/.test(base ?? '')) continue;
        for (const name of Object.getOwnPropertyNames(controller.prototype)) {
          const handler = controller.prototype[name];
          const routePath = Reflect.getMetadata(PATH_METADATA, handler);
          if (name === 'constructor' || routePath === undefined) continue;
          const method =
            RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)];
          routes.push({
            route: `${method} ${join(base, routePath)}`,
            declared:
              Reflect.getMetadata(APP_PERMISSION, handler) !== undefined ||
              Reflect.getMetadata(APP_PERMISSION, controller) !== undefined,
          });
        }
      }

    expect(routes.length).toBeGreaterThan(90);
    expect(
      routes
        .filter(
          ({ route, declared }) =>
            !declared && !DENIED_TO_INSTALLATIONS.includes(route),
        )
        .map(({ route }) => route),
    ).toEqual([]);
    expect(
      routes
        .filter(
          ({ route, declared }) =>
            declared && DENIED_TO_INSTALLATIONS.includes(route),
        )
        .map(({ route }) => route),
    ).toEqual([]);
  });

  it('every GraphQL type and root field is mapped or denied on purpose', () => {
    const { schema: graphqlSchema } = app.get(GraphQLSchemaHost);
    const types = Object.values(graphqlSchema.getTypeMap()).filter(
      (type) =>
        type instanceof GraphQLObjectType &&
        !type.name.startsWith('__') &&
        type.name !== 'Query' &&
        type.name !== 'Mutation',
    );
    const roots = [
      graphqlSchema.getQueryType()!,
      graphqlSchema.getMutationType()!,
    ].flatMap((root) =>
      Object.keys(root.getFields()).map((field) => `${root.name}.${field}`),
    );

    expect(
      types
        .map(({ name }) => name)
        .filter((name) => !(name in GRAPHQL_TYPE_PERMISSIONS)),
    ).toEqual([]);
    expect(
      roots.filter(
        (field) =>
          !(field in GRAPHQL_ROOT_PERMISSIONS) &&
          !GRAPHQL_DENIED_TO_INSTALLATIONS.includes(field),
      ),
    ).toEqual([]);
  });

  describe('GraphQL', () => {
    const graphql = (
      credential: string,
      query: string,
      variables: object = {},
    ) =>
      api()
        .post('/api/graphql')
        .set('authorization', `bearer ${credential}`)
        .send({ query, variables })
        .expect(200)
        .then(({ body }) => body);
    const REPOSITORY = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id name issues(first: 5) { nodes { title author { __typename login } } } } }`;

    it('reads what the installation allows, with the bot as a Bot', async () => {
      await as(token)
        .post(`/api/v3/repos/${installerName}/${r1}/issues`, {
          title: 'For GraphQL',
        })
        .expect(201);

      const body = await graphql(token, REPOSITORY, {
        owner: installerName,
        name: r1,
      });

      expect(body.errors).toBeUndefined();
      expect(body.data.repository.name).toBe(r1);
      expect(body.data.repository.issues.nodes).toContainEqual({
        title: 'For GraphQL',
        author: { __typename: 'Bot', login: botLogin.replace(/\[bot\]$/, '') },
      });
    });

    it('counts a GraphQL request against the rate limit', async () => {
      const response = await api()
        .post('/api/graphql')
        .set('authorization', `bearer ${token}`)
        .send({ query: '{ viewer { login } }' })
        .expect(200);

      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
    });

    it('hides a repository the installation does not cover', async () => {
      const body = await graphql(token, REPOSITORY, {
        owner: installerName,
        name: r2,
      });

      expect(body.data?.repository ?? null).toBeNull();
    });

    it('denies a field the installation has no permission for', async () => {
      const body = await graphql(
        token,
        `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { pullRequests(first: 1) { totalCount } } }`,
        { owner: installerName, name: r1 },
      );

      expect(body.errors[0].message).toBe(FORBIDDEN);
    });

    it('denies a field mapped to no permission', async () => {
      const body = await graphql(
        token,
        `mutation { createRepository(input: { name: "nope", visibility: PRIVATE }) { repository { id } } }`,
      );

      expect(body.errors[0].message).toBe(FORBIDDEN);
    });

    it('a mutation needs write', async () => {
      const {
        data: { repository },
      } = await graphql(token, REPOSITORY, {
        owner: installerName,
        name: r1,
      });
      const CREATE = `mutation($id: ID!) { createIssue(input: { repositoryId: $id, title: "From GraphQL" }) { issue { title } } }`;

      const refused = await graphql(narrowToken, CREATE, { id: repository.id });
      expect(refused.errors[0].message).toBe(FORBIDDEN);
      const created = await graphql(token, CREATE, { id: repository.id });
      expect(created.errors).toBeUndefined();
      expect(created.data.createIssue.issue.title).toBe('From GraphQL');
    });
  });

  it('writes where the installation allows', async () => {
    const { body } = await as(token)
      .post(`/api/v3/repos/${installerName}/${r1}/issues`, {
        title: 'From the bot',
      })
      .expect(201);

    expect(body.user).toMatchObject({ login: botLogin, type: 'Bot' });
  });

  it('refuses a permission it lacks', async () => {
    const { body: status } = await as(token)
      .post(`/api/v3/repos/${installerName}/${r1}/statuses/${'a'.repeat(40)}`, {
        state: 'success',
      })
      .expect(403);
    expect(status.message).toBe(FORBIDDEN);
    await as(token)
      .get(`/api/v3/repos/${installerName}/${r1}/pulls`)
      .expect(403);
  });

  it('hides a private repository outside the installation', async () => {
    await as(token)
      .get(`/api/v3/repos/${installerName}/${r2}/issues`)
      .expect(404);
  });

  it('reads a public repository as anyone can', async () => {
    await as(token)
      .get(`/api/v3/repos/${installerName}/${pub}/pulls`)
      .expect(200);
    const { body } = await as(token)
      .post(`/api/v3/repos/${installerName}/${pub}/issues`, { title: 'Nope' })
      .expect(403);
    expect(body.message).toBe(FORBIDDEN);
  });

  it('refuses an undeclared route', async () => {
    const { body } = await as(token).get('/api/v3/user').expect(403);
    expect(body.message).toBe(FORBIDDEN);
    await as(token)
      .patch(`/api/v3/repos/${installerName}/${r1}`, { description: 'x' })
      .expect(403);
  });

  it('respects a narrowed token', async () => {
    await as(narrowToken)
      .post(`/api/v3/repos/${installerName}/${r1}/issues`, { title: 'Narrow' })
      .expect(403);
    await as(narrowToken)
      .get(`/api/v3/repos/${installerName}/${r1}/issues`)
      .expect(200);
  });

  it("refuses a token on another installation's repository", async () => {
    await as(token).get(`/api/v3/repos/${otherName}/${o1}/issues`).expect(404);
  });

  it('loses a repository transferred to another account', async () => {
    await as(token)
      .get(`/api/v3/repos/${installerName}/${moved}/issues`)
      .expect(200);
    await api()
      .post(`/api/repositories/${installerName}/${moved}/transfer`)
      .set('cookie', installer.cookie)
      .send({ owner: org })
      .expect(201);

    await as(token).get(`/api/v3/repos/${org}/${moved}/issues`).expect(404);
    await as(token)
      .get(`/api/v3/repos/${installerName}/${moved}/issues`)
      .expect(404);
  });

  it('fetches but does not push', async () => {
    const clone = path.join(work, 'clone');
    await git(work, 'clone', '-q', remote(token, installerName, r1), clone);
    writeFileSync(path.join(clone, 'b.txt'), 'two\n');
    await git(clone, 'add', '.');
    await git(clone, 'commit', '-q', '-m', 'second');

    await expect(git(clone, 'push', '-q', 'origin', 'main')).rejects.toThrow(
      /403/,
    );
    await expect(
      git(
        work,
        'clone',
        '-q',
        remote(token, installerName, r2),
        path.join(work, 'nope'),
      ),
    ).rejects.toThrow(/not found|404/i);
  });

  it('refuses an LFS upload batch', async () => {
    const batch = (operation: string) =>
      api()
        .post(`/${installerName}/${r1}.git/info/lfs/objects/batch`)
        .set('accept', LFS)
        .set('content-type', LFS)
        .set(
          'authorization',
          `Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
        )
        .send(
          JSON.stringify({
            operation,
            transfers: ['basic'],
            objects: [{ oid: 'a'.repeat(64), size: 1 }],
          }),
        );

    await batch('upload').expect(403);
    await batch('download').expect(200);
  });

  it('pushes with contents write', async () => {
    const writer = await installedApp({ contents: 'write' }, [
      { cookie: installer.cookie, account: installerName, repositories: [r1] },
    ]);
    const writerToken = await writer.mint();
    const clone = path.join(work, 'writer');
    await git(
      work,
      'clone',
      '-q',
      remote(writerToken, installerName, r1),
      clone,
    );
    writeFileSync(path.join(clone, 'c.txt'), 'three\n');
    await git(clone, 'add', '.');
    await git(clone, 'commit', '-q', '-m', 'third');

    await git(clone, 'push', '-q', 'origin', 'HEAD:refs/heads/bot');

    const { stdout } = await git(
      work,
      'ls-remote',
      remote(installer.key, installerName, r1),
    );
    expect(stdout).toContain('refs/heads/bot');
  });

  it('leaves users alone', async () => {
    await as(installer.key)
      .get(`/api/v3/repos/${installerName}/${r2}/issues`)
      .expect(200);
    await as(installer.key).get('/api/v3/user').expect(200);
    await as(installer.key)
      .post(`/api/v3/repos/${installerName}/${r1}/statuses/${'a'.repeat(40)}`, {
        state: 'success',
      })
      .expect((response) => expect(response.status).not.toBe(403));
  });
});
