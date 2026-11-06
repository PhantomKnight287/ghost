import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { type Database, schema } from '@ghost/db';
import { App } from '@octokit/app';
import { Octokit } from '@octokit/core';
import type { INestApplication } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import {
  generateUserToken,
  hashUserToken,
} from '../src/lib/apps/user-token.js';
import { hasBackends, signUp, startApp } from './harness.js';

type Installed = {
  octokit: Awaited<ReturnType<App['getInstallationOctokit']>>;
  id: string;
  appId: number;
  slug: string;
};

describe.skipIf(!hasBackends)('GitHub check runs and check suites', () => {
  let app: INestApplication;
  let db: Database;
  let origin: string;
  let work: string;
  let owner: { cookie: string; key: string; userId: string };
  let installer: { cookie: string; key: string; userId: string };
  let ci: Installed;
  let other: Installed;
  let statusesOnly: Installed;
  let head: string;
  let main: string;
  let pull: number;
  const stamp = Date.now();
  const installerName = `ckinstaller${stamp}`;
  const repo = `ckrepo${stamp}`;
  const api = () => request(app.getHttpServer());
  const git = (cwd: string, ...args: string[]) =>
    promisify(execFile)(
      'git',
      ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
      { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
  const base = () => `/repos/${installerName}/${repo}`;

  async function install(
    name: string,
    permissions: Record<string, string>,
  ): Promise<Installed> {
    const { body } = await api()
      .post('/api/apps')
      .set('cookie', owner.cookie)
      .send({
        name,
        homepageUrl: 'https://bot.example',
        permissions,
        events: [],
      })
      .expect(201);
    const { body: key } = await api()
      .post(`/api/apps/${body.slug}/private-keys`)
      .set('cookie', owner.cookie)
      .expect(201);
    const { body: installation } = await api()
      .post(`/api/apps/${body.slug}/installations`)
      .set('cookie', installer.cookie)
      .send({ account: installerName, repositorySelection: 'all' })
      .expect(201);
    const octokitApp = new App({
      appId: body.appId,
      privateKey: key.privateKey,
      Octokit: Octokit.defaults({ baseUrl: `${origin}/api/v3` }),
    });
    return {
      octokit: await octokitApp.getInstallationOctokit(
        installation.installationId,
      ),
      id: body.id,
      appId: body.appId,
      slug: body.slug,
    };
  }

  beforeAll(async () => {
    ({ app, origin } = await startApp());
    db = app.get<Database>(DATABASE);
    owner = await signUp(app, `ckowner${stamp}`);
    installer = await signUp(app, installerName);
    await api()
      .post('/api/repositories')
      .set('cookie', installer.cookie)
      .send({ name: repo, visibility: 'private' })
      .expect(201);

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-checks-'));
    const seed = path.join(work, 'seed');
    execFileSync('git', ['init', '-q', '-b', 'main', seed]);
    writeFileSync(path.join(seed, 'a.txt'), 'one\n');
    await git(seed, 'add', '.');
    await git(seed, 'commit', '-q', '-m', 'first');
    main = (await git(seed, 'rev-parse', 'HEAD')).stdout.trim();
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

    ci = await install(`Checks CI ${stamp}`, { checks: 'write' });
    other = await install(`Checks Other ${stamp}`, { checks: 'write' });
    statusesOnly = await install(`Checks Statuses ${stamp}`, {
      statuses: 'write',
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it("creates a run, completes it with annotations, and reads it back in GitHub's shape", async () => {
    const { data: created } = await ci.octokit.request(
      `POST ${base()}/check-runs`,
      {
        name: 'test',
        head_sha: head,
        details_url: 'https://ci.example.com/runs/1',
        external_id: 'job-1',
        status: 'in_progress',
        output: {
          title: 'Running',
          summary: 'Started',
          images: [{ alt: 'x', image_url: 'https://x.example/x.png' }],
        },
      },
    );
    expect(created).toMatchObject({
      name: 'test',
      head_sha: head,
      status: 'in_progress',
      conclusion: null,
      external_id: 'job-1',
      details_url: 'https://ci.example.com/runs/1',
      output: { title: 'Running', summary: 'Started', annotations_count: 0 },
      app: { id: ci.appId, slug: ci.slug },
      pull_requests: [],
    });
    expect(typeof created.id).toBe('number');
    expect(created.check_suite).toEqual({ id: expect.any(Number) });
    expect(created.url).toMatch(
      new RegExp(`/api/v3${base()}/check-runs/${created.id}$`),
    );
    expect(created.output.annotations_url).toBe(`${created.url}/annotations`);

    const { data: done } = await ci.octokit.request(
      `PATCH ${base()}/check-runs/{id}`,
      {
        id: created.id,
        conclusion: 'failure',
        output: {
          title: '1 test failed',
          summary: 'See below',
          text: 'log tail',
          annotations: [
            {
              path: 'a.txt',
              start_line: 2,
              end_line: 2,
              annotation_level: 'failure',
              message: 'expected one, got two',
            },
            {
              path: 'a.txt',
              start_line: 1,
              end_line: 1,
              annotation_level: 'notice',
              message: 'fine',
              title: 'Note',
            },
          ],
        },
      },
    );
    expect(done).toMatchObject({
      status: 'completed',
      conclusion: 'failure',
      output: {
        title: '1 test failed',
        text: 'log tail',
        annotations_count: 2,
      },
    });
    expect(done.completed_at).not.toBeNull();

    const { data: read } = await ci.octokit.request(
      `GET ${base()}/check-runs/{id}`,
      { id: created.id },
    );
    expect(read).toEqual(done);
    const { data: annotations } = await ci.octokit.request(
      `GET ${base()}/check-runs/{id}/annotations`,
      { id: created.id },
    );
    expect(annotations).toEqual([
      expect.objectContaining({
        path: 'a.txt',
        start_line: 2,
        annotation_level: 'failure',
        message: 'expected one, got two',
        title: null,
      }),
      expect.objectContaining({ annotation_level: 'notice', title: 'Note' }),
    ]);
  });

  it("lists a commit's runs, newest per app and name, filtered", async () => {
    const run = (octokit: Installed['octokit'], name: string) =>
      octokit.request(`POST ${base()}/check-runs`, { name, head_sha: main });
    await run(ci.octokit, 'lint');
    const { data: newer } = await run(ci.octokit, 'lint');
    await run(other.octokit, 'lint');
    const { data: latest } = await ci.octokit.request(
      `GET ${base()}/commits/main/check-runs`,
    );
    expect(latest.total_count).toBe(2);
    expect(latest.check_runs.map((r: { id: number }) => r.id)).toContain(
      newer.id,
    );
    const { data: all } = await ci.octokit.request(
      `GET ${base()}/commits/{ref}/check-runs`,
      { ref: main, filter: 'all', check_name: 'lint', status: 'queued' },
    );
    expect(all.total_count).toBe(3);
    const { data: theirs } = await ci.octokit.request(
      `GET ${base()}/commits/main/check-runs`,
      { app_id: other.appId },
    );
    expect(
      theirs.check_runs.map((r: { app: { slug: string } }) => r.app.slug),
    ).toEqual([other.slug]);
  });

  it('lists, creates and re-requests suites, and re-requests a run', async () => {
    const { data: suite } = await other.octokit.request(
      `POST ${base()}/check-suites`,
      { head_sha: main },
    );
    expect(suite).toMatchObject({
      head_sha: main,
      app: { slug: other.slug },
      pull_requests: [],
    });
    const { data: again } = await other.octokit.request(
      `POST ${base()}/check-suites`,
      { head_sha: main },
    );
    expect(again.id).toBe(suite.id);
    const { data: listed } = await ci.octokit.request(
      `GET ${base()}/commits/main/check-suites`,
      { app_id: other.appId },
    );
    expect(listed.check_suites.map((s: { id: number }) => s.id)).toEqual([
      suite.id,
    ]);
    const { data: one } = await ci.octokit.request(
      `GET ${base()}/check-suites/{id}`,
      { id: suite.id },
    );
    expect(one.id).toBe(suite.id);
    const { data: runs } = await ci.octokit.request(
      `GET ${base()}/check-suites/{id}/check-runs`,
      { id: suite.id },
    );
    expect(
      runs.check_runs.every(
        (r: { app: { slug: string } }) => r.app.slug === other.slug,
      ),
    ).toBe(true);

    const { status } = await other.octokit.request(
      `POST ${base()}/check-suites/{id}/rerequest`,
      { id: suite.id },
    );
    expect(status).toBe(201);
    const { data: run } = await ci.octokit.request(
      `POST ${base()}/check-runs`,
      {
        name: 'rerun-me',
        head_sha: main,
      },
    );
    await api()
      .post(`/api/v3${base()}/check-runs/${run.id}/rerequest`)
      .set('authorization', `token ${installer.key}`)
      .expect(201);
    const events = await db
      .select({ type: schema.outboxEvent.type })
      .from(schema.outboxEvent)
      .where(eq(schema.outboxEvent.type, 'check_run.rerequested'));
    expect(events.length).toBeGreaterThan(0);
  });

  it('refuses writes from anything but the owning installation', async () => {
    const body = { name: 'forged', head_sha: head, conclusion: 'success' };
    const { body: pat } = await api()
      .post(`/api/v3${base()}/check-runs`)
      .set('authorization', `token ${installer.key}`)
      .send(body)
      .expect(403);
    expect(pat.message).toBe('You must authenticate via a GitHub App.');

    const ghu = generateUserToken();
    await db.insert(schema.appUserToken).values({
      appId: ci.id,
      userId: installer.userId,
      tokenHash: hashUserToken(ghu),
    });
    await api()
      .post(`/api/v3${base()}/check-runs`)
      .set('authorization', `token ${ghu}`)
      .send(body)
      .expect(403);

    await expect(
      statusesOnly.octokit.request(`POST ${base()}/check-runs`, body),
    ).rejects.toMatchObject({
      status: 403,
      response: { data: { message: 'Resource not accessible by integration' } },
    });

    const { data: mine } = await ci.octokit.request(
      `POST ${base()}/check-runs`,
      {
        name: 'mine',
        head_sha: head,
      },
    );
    await expect(
      other.octokit.request(`PATCH ${base()}/check-runs/{id}`, {
        id: mine.id,
        conclusion: 'success',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses what GitHub refuses with 422', async () => {
    const annotation = {
      path: 'a.txt',
      start_line: 1,
      end_line: 1,
      annotation_level: 'warning',
      message: 'm',
    };
    const action = { label: 'Fix', description: 'Fix it', identifier: 'fix' };
    for (const body of [
      {
        name: 'x',
        head_sha: head,
        output: {
          title: 't',
          summary: 's',
          annotations: Array(51).fill(annotation),
        },
      },
      { name: 'x', head_sha: head, actions: Array(4).fill(action) },
      { name: 'x'.repeat(256), head_sha: head },
      { name: 'x', head_sha: head, status: 'completed' },
      { name: 'x', head_sha: head, conclusion: 'action_required' },
    ])
      await expect(
        ci.octokit.request(`POST ${base()}/check-runs`, body),
      ).rejects.toMatchObject({ status: 422 });
  });

  it('a web merge of a pull request requests a suite for the merge commit', async () => {
    const { body: merged } = await api()
      .put(`/api/v3${base()}/pulls/${pull}/merge`)
      .set('authorization', `token ${installer.key}`)
      .send({ merge_method: 'merge' })
      .expect(200);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const suites = await db
      .select({
        appId: schema.checkSuite.appId,
        headBranch: schema.checkSuite.headBranch,
      })
      .from(schema.checkSuite)
      .where(and(eq(schema.checkSuite.headSha, merged.sha)));
    expect(suites.map((s) => s.appId).sort()).toEqual([ci.id, other.id].sort());
    expect(suites.every((s) => s.headBranch === 'main')).toBe(true);
  });
});
