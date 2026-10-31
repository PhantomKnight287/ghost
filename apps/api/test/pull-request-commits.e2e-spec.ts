import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { type Database, schema } from '@ghost/db';
import { and, eq } from 'drizzle-orm';

import { DATABASE } from '../src/database/database.module.js';
import { hasBackends, signUp, startApp } from './harness.js';

type TimelineEvent = {
  kind: string;
  event?: {
    type: string;
    actorUsername: string;
    commitSha: string | null;
    beforeSha: string | null;
    commitMessage: string | null;
    commitAuthorName: string | null;
  };
};

describe.skipIf(!hasBackends)('commits in a pull request timeline', () => {
  let app: INestApplication;
  let origin: string;
  let owner: { cookie: string; key: string };
  let watcher: { cookie: string; key: string };
  let work: string;
  const username = `prcommits${Date.now()}`;
  const watcherName = `prwatch${Date.now()}`;
  let repo: string;

  const api = () => request(app.getHttpServer());
  const remote = () =>
    `${origin.replace('://', `://${username}:${owner.key}@`)}/${username}/${repo}.git`;
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=Ada', '-c', 'user.email=ada@example.com', ...args],
      { cwd: work, encoding: 'utf8' },
    ).trim();
  // The server runs in this process, so anything that talks to it must not block the event loop.
  const push = (...args: string[]) =>
    promisify(execFile)('git', ['push', '-q', remote(), ...args], {
      cwd: work,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  const commit = (file: string, message: string) => {
    writeFileSync(path.join(work, file), `${message}\n`);
    git('add', file);
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  /** The commit and force-push events, oldest first. */
  const pushEvents = async () => {
    const { body } = await api()
      .get(`/api/repositories/${username}/${repo}/issues/1/timeline`)
      .set('cookie', owner.cookie)
      .expect(200);
    return (body.timeline as TimelineEvent[])
      .filter(
        (item) =>
          item.event?.type === 'committed' ||
          item.event?.type === 'head_force_pushed',
      )
      .map(({ event }) =>
        event!.type === 'committed'
          ? `${event!.commitMessage} ${event!.commitSha} by ${event!.commitAuthorName}`
          : `forced ${event!.beforeSha}..${event!.commitSha}`,
      );
  };

  beforeAll(async () => {
    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-pr-commits-'));
    ({ app, origin } = await startApp());
    owner = await signUp(app, username);
    watcher = await signUp(app, watcherName);
    repo = (
      await api()
        .post('/api/repositories')
        .set('cookie', owner.cookie)
        .send({ name: 'commits', visibility: 'public' })
        .expect(201)
    ).body.slug;

    git('init', '-q', '-b', 'main');
    commit('main.txt', 'first');
    await push('main');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('lists the commits a request opens with, then each push, leaving out base commits merged in, and marks a force push', async () => {
    git('checkout', '-q', '-b', 'feature');
    const a = commit('a.txt', 'add a');
    await push('feature');
    await api()
      .post(`/api/repositories/${username}/${repo}/pulls`)
      .set('cookie', owner.cookie)
      .send({ title: 'Feature', base: 'main', head: 'feature' })
      .expect(201);
    expect(await pushEvents()).toEqual([`add a ${a} by Ada`]);
    // a participant, who would hear about a comment, must not hear about pushes
    await api()
      .post(`/api/repositories/${username}/${repo}/issues/1/comments`)
      .set('cookie', watcher.cookie)
      .send({ body: 'Following along' })
      .expect(201);

    const b = commit('b.txt', 'add b');
    await push('feature');
    await vi.waitFor(
      async () =>
        expect(await pushEvents()).toEqual([
          `add a ${a} by Ada`,
          `add b ${b} by Ada`,
        ]),
      { timeout: 15_000, interval: 200 },
    );

    git('checkout', '-q', 'main');
    commit('main2.txt', 'on main');
    await push('main');
    git('checkout', '-q', 'feature');
    git('merge', '-q', '--no-edit', 'main');
    const merge = git('rev-parse', 'HEAD');
    await push('feature');
    await vi.waitFor(
      async () =>
        expect((await pushEvents()).slice(2)).toEqual([
          `Merge branch 'main' into feature ${merge} by Ada`,
        ]),
      { timeout: 15_000, interval: 200 },
    );

    git('reset', '-q', '--hard', b);
    git('commit', '-q', '--amend', '-m', 'add b, reworded');
    const amended = git('rev-parse', 'HEAD');
    await push('--force', 'feature');
    await vi.waitFor(
      async () =>
        expect((await pushEvents()).slice(3)).toEqual([
          `forced ${merge}..${amended}`,
          `add b, reworded ${amended} by Ada`,
        ]),
      { timeout: 15_000, interval: 200 },
    );

    const db = app.get<Database>(DATABASE);
    const { id: repositoryId } = (
      await api()
        .get(`/api/repositories/${username}/${repo}`)
        .set('cookie', owner.cookie)
        .expect(200)
    ).body;
    // opening the request is `issue.opened`, not a synchronize
    await vi.waitFor(
      async () => {
        const events = await db
          .select({
            payload: schema.outboxEvent.payload,
            processedAt: schema.outboxEvent.processedAt,
          })
          .from(schema.outboxEvent)
          .where(
            and(
              eq(schema.outboxEvent.type, 'pull_request.synchronized'),
              eq(schema.outboxEvent.repositoryId, repositoryId),
            ),
          )
          .orderBy(schema.outboxEvent.createdAt);
        expect(
          events.map(({ payload }) => {
            const { after, forced, commits } = payload as {
              after: string;
              forced: boolean;
              commits: { sha: string }[];
            };
            return [after, forced, commits.map((commit) => commit.sha)];
          }),
        ).toEqual([
          [b, false, [b]],
          [merge, false, [merge]],
          [amended, true, [amended]],
        ]);
        expect(events.every((event) => event.processedAt)).toBe(true);
      },
      { timeout: 15_000, interval: 200 },
    );

    const [watcherRow] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.username, watcherName));
    expect(
      await db
        .select()
        .from(schema.notification)
        .where(eq(schema.notification.userId, watcherRow.id)),
    ).toEqual([]);
  }, 90_000);
});
