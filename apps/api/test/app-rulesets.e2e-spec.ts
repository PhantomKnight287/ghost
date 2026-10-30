import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { App } from '@octokit/app';
import { Octokit } from '@octokit/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Database, schema } from '@ghost/db';
import { eq } from 'drizzle-orm';

import { DATABASE } from '../src/database/database.module.js';
import {
  generateUserToken,
  hashUserToken,
} from '../src/lib/apps/user-token.js';
import { hasBackends, signUp, startApp } from './harness.js';

const NO_REQUIREMENTS = {
  required_approving_review_count: 0,
  dismiss_stale_reviews_on_push: false,
  require_code_owner_review: false,
  require_last_push_approval: false,
  required_review_thread_resolution: false,
  allowed_merge_methods: ['merge', 'squash', 'rebase'],
};

describe.skipIf(!hasBackends)('Rulesets and apps', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let origin: string;
  let work: string;
  let appOwner: { cookie: string; key: string; userId: string };
  let installer: { cookie: string; key: string; userId: string };
  let ci: Awaited<ReturnType<typeof installedApp>>;
  let otherApp: Awaited<ReturnType<typeof installedApp>>;
  const stamp = Date.now();
  const installerName = `arinstaller${stamp}`;
  const name = `arrepo${stamp}`;
  const repo = `${installerName}/${name}`;
  let apps = 0;
  let counter = 0;
  const http = () => request(app.getHttpServer());
  const run = (cwd: string, ...args: string[]) =>
    promisify(execFile)(
      'git',
      ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
      { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
  const git = (...args: string[]) => run(work, ...args);
  const remote = (credential: string) =>
    `${origin.replace('://', `://x-access-token:${credential}@`)}/${repo}.git`;
  const rest = (credential: string) => ({
    get: (url: string) =>
      http()
        .get(`/api/v3/repos/${repo}${url}`)
        .set('authorization', `token ${credential}`),
    post: (url: string, body: object) =>
      http()
        .post(`/api/v3/repos/${repo}${url}`)
        .set('authorization', `token ${credential}`)
        .send(body),
    put: (url: string, body: object) =>
      http()
        .put(`/api/v3/repos/${repo}${url}`)
        .set('authorization', `token ${credential}`)
        .send(body),
  });

  const installedApp = async (permissions: Record<string, string>) => {
    const { body } = await http()
      .post('/api/apps')
      .set('cookie', appOwner.cookie)
      .send({
        name: `Rules ${stamp} ${apps++}`,
        homepageUrl: 'https://bot.example',
        permissions,
        events: [],
      })
      .expect(201);
    const { body: key } = await http()
      .post(`/api/apps/${body.slug}/private-keys`)
      .set('cookie', appOwner.cookie)
      .expect(201);
    const { body: installation } = await http()
      .post(`/api/apps/${body.slug}/installations`)
      .set('cookie', installer.cookie)
      .send({ account: installerName, repositorySelection: 'all' })
      .expect(201);
    const octokitApp = new App({
      appId: body.appId,
      privateKey: key.privateKey,
      Octokit: Octokit.defaults({ baseUrl: `${origin}/api/v3` }),
    });
    const token = async () =>
      (
        await octokitApp.octokit.request(
          'POST /app/installations/{installation_id}/access_tokens',
          { installation_id: installation.installationId },
        )
      ).data.token;
    return {
      appId: body.appId as number,
      slug: body.slug as string,
      token: await token(),
    };
  };

  /** A fresh base branch off main, with `files` added on it, and an open pull request into it from the installer. */
  const pullRequest = async (files: Record<string, string> = {}) => {
    const base = `base-${++counter}`;
    await git('checkout', '-q', '-B', base, 'main');
    for (const [file, text] of Object.entries(files))
      writeFileSync(path.join(work, file), text);
    if (Object.keys(files).length > 0) {
      await git('add', '-A');
      await git('commit', '-q', '-m', `files for ${base}`);
    }
    await git(
      'push',
      '-q',
      remote(installer.key),
      `${base}:refs/heads/${base}`,
    );
    const head = `${base}-head`;
    await git('checkout', '-q', '-B', head, base);
    writeFileSync(path.join(work, `${head}.txt`), `${head}\n`);
    await git('add', '-A');
    await git('commit', '-q', '-m', `work on ${head}`);
    await git(
      'push',
      '-q',
      remote(installer.key),
      `${head}:refs/heads/${head}`,
    );
    const sha = (await git('rev-parse', 'HEAD')).stdout.trim();
    const { body } = await rest(installer.key)
      .post('/pulls', { title: head, base, head })
      .expect(201);
    return { base, head, sha, number: body.number as number };
  };
  const ruleset = async (
    base: string,
    rules: object[],
    bypass_actors: object[] = [],
  ) =>
    (
      await rest(installer.key)
        .post('/rulesets', {
          name: `${base} ${++counter}`,
          target: 'branch',
          enforcement: 'active',
          conditions: {
            ref_name: { include: [`refs/heads/${base}`], exclude: [] },
          },
          rules,
          bypass_actors,
        })
        .expect(201)
    ).body;
  const status = (credential: string, sha: string, state: string) =>
    rest(credential)
      .post(`/statuses/${sha}`, { state, context: 'ci' })
      .expect(201);

  beforeAll(async () => {
    ({ app, origin } = await startApp());
    appOwner = await signUp(app, `arowner${stamp}`);
    installer = await signUp(app, installerName);
    await http()
      .post('/api/repositories')
      .set('cookie', installer.cookie)
      .send({ name, visibility: 'private' })
      .expect(201);
    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-app-rulesets-'));
    execFileSync('git', ['init', '-q', '-b', 'main', work]);
    writeFileSync(path.join(work, 'a.txt'), 'one\n');
    await git('add', '.');
    await git('commit', '-q', '-m', 'first');
    await git('push', '-q', remote(installer.key), 'main');
    ci = await installedApp({
      statuses: 'write',
      contents: 'write',
      pull_requests: 'write',
    });
    otherApp = await installedApp({
      contents: 'write',
      pull_requests: 'write',
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('accepts integration_id', async () => {
    const made = await ruleset(`pin-${stamp}`, [
      {
        type: 'required_status_checks',
        parameters: {
          required_status_checks: [{ context: 'ci', integration_id: ci.appId }],
          strict_required_status_checks_policy: false,
        },
      },
    ]);
    const { body } = await rest(installer.key)
      .get(`/rulesets/${made.id}`)
      .expect(200);
    expect(body.rules[0].parameters.required_status_checks).toEqual([
      { context: 'ci', integration_id: ci.appId },
    ]);
    const { body: graph } = await http()
      .post('/api/graphql')
      .set('authorization', `token ${installer.key}`)
      .send({
        query: `{ repository(owner: "${installerName}", name: "${name}") { rulesets(first: 100) { nodes { name rules(first: 10) { nodes { parameters { ... on RequiredStatusChecksParameters { requiredStatusChecks { context integrationId } } } } } } } } }`,
      })
      .expect(200);
    const node = graph.data.repository.rulesets.nodes.find(
      (rulesetNode: { name: string }) => rulesetNode.name === made.name,
    );
    expect(node.rules.nodes[0].parameters.requiredStatusChecks).toEqual([
      { context: 'ci', integrationId: ci.appId },
    ]);

    await rest(installer.key)
      .post('/rulesets', {
        name: `unknown ${stamp}`,
        target: 'branch',
        enforcement: 'active',
        conditions: {
          ref_name: { include: ['refs/heads/nowhere'], exclude: [] },
        },
        rules: [
          {
            type: 'required_status_checks',
            parameters: {
              required_status_checks: [
                { context: 'ci', integration_id: 999999999 },
              ],
            },
          },
        ],
      })
      .expect(422);
  });

  it("merges only on the app's status", async () => {
    const { base, sha, number } = await pullRequest();
    await ruleset(base, [
      {
        type: 'required_status_checks',
        parameters: {
          required_status_checks: [{ context: 'ci', integration_id: ci.appId }],
          strict_required_status_checks_policy: false,
        },
      },
    ]);

    await status(installer.key, sha, 'success');
    const { body } = await rest(installer.key)
      .put(`/pulls/${number}/merge`, { merge_method: 'merge' })
      .expect(405);
    expect(body.message).toContain('Required status check "ci" is expected.');

    await status(ci.token, sha, 'success');
    await rest(installer.key)
      .put(`/pulls/${number}/merge`, { merge_method: 'merge' })
      .expect(200);
  });

  it('a user-to-server status does not satisfy a pinned check', async () => {
    const { base, sha, number } = await pullRequest();
    await ruleset(base, [
      {
        type: 'required_status_checks',
        parameters: {
          required_status_checks: [{ context: 'ci', integration_id: ci.appId }],
          strict_required_status_checks_policy: false,
        },
      },
    ]);
    const db = app.get<Database>(DATABASE);
    const [ciApp] = await db
      .select({ id: schema.app.id })
      .from(schema.app)
      .where(eq(schema.app.slug, ci.slug));
    const ghu = generateUserToken();
    await db.insert(schema.appUserToken).values({
      appId: ciApp!.id,
      userId: installer.userId,
      tokenHash: hashUserToken(ghu),
    });

    await status(ghu, sha, 'success');
    const { body } = await rest(installer.key)
      .put(`/pulls/${number}/merge`, { merge_method: 'merge' })
      .expect(405);
    expect(body.message).toContain('Required status check "ci" is expected.');
  });

  /** A merge commit on `base`, pushed with `credential`. */
  const pushMerge = async (base: string, credential: string) => {
    await git(
      'fetch',
      '-q',
      remote(installer.key),
      `${base}:refs/remotes/server/${base}`,
    );
    await git('checkout', '-q', '-B', `${base}-side`, `server/${base}`);
    writeFileSync(path.join(work, `${base}-side-${++counter}.txt`), 'side\n');
    await git('add', '-A');
    await git('commit', '-q', '-m', 'side');
    await git('checkout', '-q', '-B', `${base}-merge`, `server/${base}`);
    writeFileSync(path.join(work, `${base}-main-${++counter}.txt`), 'main\n');
    await git('add', '-A');
    await git('commit', '-q', '-m', 'main');
    await git('merge', '-q', '--no-ff', '-m', 'merge', `${base}-side`);
    return git('push', '-q', remote(credential), `HEAD:refs/heads/${base}`);
  };

  it('bypasses for an Integration actor', async () => {
    const { base } = await pullRequest();
    await ruleset(
      base,
      [{ type: 'required_linear_history' }],
      [
        {
          actor_type: 'Integration',
          actor_id: ci.appId,
          bypass_mode: 'always',
        },
      ],
    );

    await expect(pushMerge(base, otherApp.token)).rejects.toThrow();
    await pushMerge(base, ci.token);
  });

  it('does not bypass by repository role', async () => {
    const { base } = await pullRequest();
    await ruleset(
      base,
      [{ type: 'required_linear_history' }],
      [{ actor_type: 'RepositoryRole', actor_id: 4, bypass_mode: 'always' }],
    );

    await expect(pushMerge(base, otherApp.token)).rejects.toThrow();
  });

  it('counts a bot approval', async () => {
    const { base, number } = await pullRequest();
    await ruleset(base, [
      {
        type: 'pull_request',
        parameters: { ...NO_REQUIREMENTS, required_approving_review_count: 1 },
      },
    ]);
    await rest(installer.key)
      .put(`/pulls/${number}/merge`, { merge_method: 'merge' })
      .expect(405);

    await rest(otherApp.token)
      .post(`/pulls/${number}/reviews`, { event: 'APPROVE' })
      .expect(200);

    await rest(installer.key)
      .put(`/pulls/${number}/merge`, { merge_method: 'merge' })
      .expect(200);
  });

  it('satisfies code owners only when named', async () => {
    const codeOwnerRule = [
      {
        type: 'pull_request',
        parameters: { ...NO_REQUIREMENTS, require_code_owner_review: true },
      },
    ];
    const ownerName = `arcodeowner${stamp}`;
    const owner = await signUp(app, ownerName);
    await http()
      .put(`/api/repositories/${repo}/collaborators/${ownerName}`)
      .set('cookie', installer.cookie)
      .send({ role: 'write' })
      .expect(200);
    const { body: invitations } = await http()
      .get('/api/invitations')
      .set('cookie', owner.cookie)
      .expect(200);
    await http()
      .post(`/api/invitations/${invitations.invitations[0].id}/accept`)
      .set('cookie', owner.cookie)
      .expect(204);
    const human = await pullRequest({ CODEOWNERS: `* @${ownerName}\n` });
    await ruleset(human.base, codeOwnerRule);
    await rest(otherApp.token)
      .post(`/pulls/${human.number}/reviews`, { event: 'APPROVE' })
      .expect(200);
    await rest(installer.key)
      .put(`/pulls/${human.number}/merge`, { merge_method: 'merge' })
      .expect(405);

    const bot = await pullRequest({ CODEOWNERS: `* @${otherApp.slug}[bot]\n` });
    await ruleset(bot.base, codeOwnerRule);
    await rest(otherApp.token)
      .post(`/pulls/${bot.number}/reviews`, { event: 'APPROVE' })
      .expect(200);
    await rest(installer.key)
      .put(`/pulls/${bot.number}/merge`, { merge_method: 'merge' })
      .expect(200);
  });
});
