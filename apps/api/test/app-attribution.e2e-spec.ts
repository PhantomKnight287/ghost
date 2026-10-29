import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { type Database, schema } from '@ghost/db';
import { App } from '@octokit/app';
import { Octokit } from '@octokit/core';
import type { INestApplication } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import type { Auth } from '../src/lib/auth.js';
import { hashInstallationToken } from '../src/lib/apps/installation-token.js';
import { hasBackends, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)('What an installation token writes', () => {
  let app: INestApplication;
  let db: Database;
  let origin: string;
  let work: string;
  let appOwner: { cookie: string; key: string; userId: string };
  let installer: { cookie: string; key: string; userId: string };
  let other: { cookie: string; key: string; userId: string };
  let octokitApp: App;
  let installationId: number;
  let botLogin: string;
  let botUserId: string;
  let head: string;
  let pull: number;
  const stamp = Date.now();
  const installerName = `atinstaller${stamp}`;
  const repo = `atrepo${stamp}`;
  const hidden = `athidden${stamp}`;
  const api = () => request(app.getHttpServer());
  const git = (cwd: string, ...args: string[]) =>
    promisify(execFile)(
      'git',
      ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
      { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
  const base = () => `/repos/${installerName}/${repo}`;

  beforeAll(async () => {
    ({ app, origin } = await startApp());
    db = app.get<Database>(DATABASE);
    appOwner = await signUp(app, `atowner${stamp}`);
    installer = await signUp(app, installerName);
    other = await signUp(app, `atother${stamp}`);
    await api()
      .post('/api/repositories')
      .set('cookie', installer.cookie)
      .send({ name: repo, visibility: 'private' })
      .expect(201);
    await api()
      .post('/api/repositories')
      .set('cookie', other.cookie)
      .send({ name: hidden, visibility: 'private' })
      .expect(201);

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-app-attribution-'));
    const seed = path.join(work, 'seed');
    execFileSync('git', ['init', '-q', '-b', 'main', seed]);
    writeFileSync(path.join(seed, 'a.txt'), 'one\n');
    await git(seed, 'add', '.');
    await git(seed, 'commit', '-q', '-m', 'first');
    await git(seed, 'checkout', '-q', '-b', 'feature');
    writeFileSync(path.join(seed, 'a.txt'), 'one\ntwo\n');
    await git(seed, 'commit', '-q', '-am', 'second');
    head = (await git(seed, 'rev-parse', 'HEAD')).stdout.trim();
    await git(
      seed,
      'push',
      '-q',
      `${origin.replace('://', `://${installerName}:${installer.key}@`)}/${installerName}/${repo}.git`,
      'main',
      'feature',
    );
    const { body: opened } = await api()
      .post(`/api/v3${base()}/pulls`)
      .set('authorization', `token ${installer.key}`)
      .send({ title: 'Feature', head: 'feature', base: 'main' })
      .expect(201);
    pull = opened.number;

    const { body } = await api()
      .post('/api/apps')
      .set('cookie', appOwner.cookie)
      .send({
        name: `Reviewer ${stamp}`,
        homepageUrl: 'https://bot.example',
        permissions: {
          pull_requests: 'write',
          statuses: 'write',
          issues: 'write',
          contents: 'write',
        },
        events: [],
      })
      .expect(201);
    botLogin = body.botLogin;
    const [bot] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.username, botLogin));
    botUserId = bot!.id;
    const { body: key } = await api()
      .post(`/api/apps/${body.slug}/private-keys`)
      .set('cookie', appOwner.cookie)
      .expect(201);
    const { body: installation } = await api()
      .post(`/api/apps/${body.slug}/installations`)
      .set('cookie', installer.cookie)
      .send({ account: installerName, repositorySelection: 'all' })
      .expect(201);
    installationId = installation.installationId;
    octokitApp = new App({
      appId: body.appId,
      privateKey: key.privateKey,
      Octokit: Octokit.defaults({ baseUrl: `${origin}/api/v3` }),
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('does what a review bot does', async () => {
    const octokit = await octokitApp.getInstallationOctokit(installationId);

    const { data: diff } = await octokit.request(
      `GET ${base()}/pulls/{pull_number}`,
      { pull_number: pull, mediaType: { format: 'diff' } },
    );
    expect(String(diff)).toContain('+two');
    const { data: review } = await octokit.request(
      `POST ${base()}/pulls/{pull_number}/reviews`,
      {
        pull_number: pull,
        event: 'COMMENT',
        body: 'Looks fine',
        comments: [{ path: 'a.txt', line: 2, body: 'New line' }],
      },
    );
    expect(review.user.login).toBe(botLogin);
    const { data: comments } = await octokit.request(
      `GET ${base()}/pulls/{pull_number}/comments`,
      { pull_number: pull },
    );
    expect(
      comments.map((comment: { user: { login: string }; body: string }) => [
        comment.user.login,
        comment.body,
      ]),
    ).toContainEqual([botLogin, 'New line']);
    const { data: status } = await octokit.request(
      `POST ${base()}/statuses/{sha}`,
      { sha: head, state: 'success', context: 'ci/bot' },
    );
    expect(status.creator.login).toBe(botLogin);
    expect(status.creator.type).toBe('Bot');
  });

  it('records the installation on a status', async () => {
    const octokit = await octokitApp.getInstallationOctokit(installationId);
    await octokit.request(`POST ${base()}/statuses/{sha}`, {
      sha: head,
      state: 'pending',
      context: 'ci/installed',
    });
    await api()
      .post(`/api/v3${base()}/statuses/${head}`)
      .set('authorization', `token ${installer.key}`)
      .send({ state: 'success', context: 'ci/human' })
      .expect(201);

    const rows = await db
      .select({
        context: schema.commitStatus.context,
        installationId: schema.commitStatus.installationId,
        creatorId: schema.commitStatus.creatorId,
      })
      .from(schema.commitStatus)
      .where(eq(schema.commitStatus.sha, head));
    expect(rows.find((row) => row.context === 'ci/installed')).toMatchObject({
      installationId: expect.any(String),
      creatorId: botUserId,
    });
    expect(rows.find((row) => row.context === 'ci/human')).toMatchObject({
      installationId: null,
      creatorId: installer.userId,
    });
  });

  it('attributes every write to the bot', async () => {
    const octokit = await octokitApp.getInstallationOctokit(installationId);
    await api()
      .post(`/api/v3${base()}/labels`)
      .set('authorization', `token ${installer.key}`)
      .send({ name: 'bot', color: 'ededed' })
      .expect(201);

    const { data: comment } = await octokit.request(
      `POST ${base()}/issues/{issue_number}/comments`,
      { issue_number: pull, body: 'Summary' },
    );
    expect(comment.user.login).toBe(botLogin);
    const { status: labelled } = await octokit.request(
      `POST ${base()}/issues/{issue_number}/labels`,
      { issue_number: pull, labels: ['bot'] },
    );
    expect(labelled).toBe(200);
    const { data: release } = await octokit.request(`POST ${base()}/releases`, {
      tag_name: `v${stamp}`,
      target_commitish: 'main',
    });
    expect(release.author.login).toBe(botLogin);

    const { token } = (await octokit.auth({ type: 'installation' })) as {
      token: string;
    };
    const clone = path.join(work, 'bot');
    const remote = `${origin.replace('://', `://x-access-token:${token}@`)}/${installerName}/${repo}.git`;
    await git(work, 'clone', '-q', remote, clone);
    writeFileSync(path.join(clone, 'b.txt'), 'bot\n');
    await git(clone, 'add', '.');
    await git(clone, 'commit', '-q', '-m', 'from the bot');
    await git(clone, 'push', '-q', 'origin', 'HEAD:refs/heads/bot');
    const [repository] = await db
      .select({ id: schema.repository.id })
      .from(schema.repository)
      .where(eq(schema.repository.slug, repo));
    // The push event is published after git answers.
    await expect
      .poll(async () => {
        const [push] = await db
          .select({ actorId: schema.outboxEvent.actorId })
          .from(schema.outboxEvent)
          .where(
            and(
              eq(schema.outboxEvent.repositoryId, repository!.id),
              eq(schema.outboxEvent.type, 'push'),
              sql`${schema.outboxEvent.payload}->>'ref' = 'refs/heads/bot'`,
            ),
          );
        return push?.actorId;
      })
      .toBe(botUserId);
  });

  it('is refused outside the installation or the permission', async () => {
    const { data } = await octokitApp.octokit.request(
      'POST /app/installations/{installation_id}/access_tokens',
      {
        installation_id: installationId,
        permissions: { pull_requests: 'read' },
      },
    );

    await api()
      .post(`/api/v3${base()}/pulls/${pull}/reviews`)
      .set('authorization', `token ${data.token}`)
      .send({ event: 'COMMENT', body: 'No' })
      .expect(403);
    await api()
      .get(`/api/v3/repos/atother${stamp}/${hidden}/issues`)
      .set('authorization', `token ${data.token}`)
      .expect(404);
  });
  let others = 0;
  /** Another app on the installer's account, with its own installation id. */
  const anotherApp = async (permissions: Record<string, string>) => {
    const { body } = await api()
      .post('/api/apps')
      .set('cookie', appOwner.cookie)
      .send({
        name: `Other ${stamp} ${++others}`,
        homepageUrl: 'https://bot.example',
        permissions,
        events: [],
      })
      .expect(201);
    const { body: key } = await api()
      .post(`/api/apps/${body.slug}/private-keys`)
      .set('cookie', appOwner.cookie)
      .expect(201);
    const { body: installation } = await api()
      .post(`/api/apps/${body.slug}/installations`)
      .set('cookie', installer.cookie)
      .send({ account: installerName, repositorySelection: 'all' })
      .expect(201);
    const other = new App({
      appId: body.appId,
      privateKey: key.privateKey,
      Octokit: Octokit.defaults({ baseUrl: `${origin}/api/v3` }),
    });
    return {
      slug: body.slug as string,
      installation,
      token: (
        await other.octokit.request(
          'POST /app/installations/{installation_id}/access_tokens',
          { installation_id: installation.installationId },
        )
      ).data.token as string,
    };
  };

  it('merges only with contents write', async () => {
    const { token } = await anotherApp({
      pull_requests: 'write',
      contents: 'read',
    });

    const { body } = await api()
      .put(`/api/v3${base()}/pulls/${pull}/merge`)
      .set('authorization', `token ${token}`)
      .send({ merge_method: 'merge' })
      .expect(403);
    expect(body.message).toBe('Resource not accessible by integration');
  });

  it("never reads another installation's repository through a pull request head", async () => {
    const org = `atorg${stamp}`;
    const auth = app.get<AuthService<Auth>>(AuthService).api;
    await auth.createOrganization({
      body: { name: 'Fork Org', slug: org },
      headers: new Headers({ cookie: installer.cookie }),
    });
    await api()
      .post(`/api/repositories/${installerName}/${repo}/fork`)
      .set('cookie', installer.cookie)
      .send({ name: repo, visibility: 'private', organization: org })
      .expect(201);
    const reviewer = await anotherApp({
      pull_requests: 'write',
      contents: 'write',
    });
    await api()
      .post(`/api/apps/${reviewer.slug}/installations`)
      .set('cookie', installer.cookie)
      .send({ account: org, repositorySelection: 'all' })
      .expect(201);

    const { status } = await api()
      .post(`/api/v3${base()}/pulls`)
      .set('authorization', `token ${reviewer.token}`)
      .send({ title: 'From the fork', head: `${org}:feature`, base: 'main' });
    expect([404, 422]).toContain(status);
  });

  it('never lets a token hold more than its installation', async () => {
    const { token, installation } = await anotherApp({ issues: 'read' });
    await db
      .update(schema.appInstallationToken)
      .set({ permissions: { metadata: 'read', issues: 'write' } })
      .where(
        eq(schema.appInstallationToken.tokenHash, hashInstallationToken(token)),
      );
    expect(installation.permissions).toEqual({
      metadata: 'read',
      issues: 'read',
    });

    await api()
      .post(`/api/v3${base()}/issues`)
      .set('authorization', `token ${token}`)
      .send({ title: 'Too much' })
      .expect(403);
  });
  it('comments on a pull request with only pull_requests, as GitHub allows', async () => {
    const { token } = await anotherApp({ pull_requests: 'write' });
    const as = (call: request.Test) =>
      call.set('authorization', `token ${token}`);
    const { body: plain } = await api()
      .post(`/api/v3${base()}/issues`)
      .set('authorization', `token ${installer.key}`)
      .send({ title: 'Just an issue' })
      .expect(201);

    const { body: comment } = await as(
      api().post(`/api/v3${base()}/issues/${pull}/comments`),
    )
      .send({ body: 'Summary' })
      .expect(201);
    await as(api().patch(`/api/v3${base()}/issues/comments/${comment.id}`))
      .send({ body: 'Updated summary' })
      .expect(200);
    await as(api().post(`/api/v3${base()}/issues/${pull}/labels`))
      .send({ labels: ['bot'] })
      .expect(200);

    const { body } = await as(
      api().post(`/api/v3${base()}/issues/${plain.number}/comments`),
    )
      .send({ body: 'Not mine' })
      .expect(403);
    expect(body.message).toBe('Resource not accessible by integration');
    await as(api().get(`/api/v3${base()}/issues/${plain.number}`)).expect(403);
  });
});
