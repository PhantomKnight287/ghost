import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, signUp, startApp } from './harness.js';

type Commit = { sha: string; status: { state: string } | null };

describe.skipIf(!hasBackends)(
  'commit statuses on pull requests and commit lists',
  () => {
    let app: INestApplication;
    let origin: string;
    let upstream: { cookie: string; key: string };
    let forker: { cookie: string; key: string };
    let work: string;
    let main: string;
    let same: string;
    let forked: string;
    let spoof: string;
    let withStatus: number;
    const owner = `checksup${Date.now()}`;
    const contributor = `checksfork${Date.now()}`;
    const repos = `/api/repositories/${owner}/app`;
    const forkRepos = `/api/repositories/${contributor}/fork`;

    const api = () => request(app.getHttpServer());
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
        { cwd: work, encoding: 'utf8' },
      ).trim();
    // The server runs in this process, so anything that talks to it must not block the event loop.
    const push = (
      username: string,
      key: string,
      slug: string,
      ...refs: string[]
    ) =>
      promisify(execFile)(
        'git',
        [
          'push',
          '-q',
          `${origin.replace('://', `://${username}:${key}@`)}/${username}/${slug}.git`,
          ...refs,
        ],
        { cwd: work, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      );
    const branch = (name: string) => {
      git('checkout', '-q', '-b', name, 'main');
      git('commit', '-q', '--allow-empty', '-m', name);
      return git('rev-parse', 'HEAD');
    };
    const openPull = (cookie: string, head: string) =>
      api()
        .post(`${repos}/pulls`)
        .set('cookie', cookie)
        .send({ title: head, base: 'main', head })
        .expect(201)
        .then((response) => response.body.number as number);
    const postStatus = (
      at: string,
      cookie: string,
      sha: string,
      state = 'success',
    ) =>
      api()
        .post(`${at}/statuses/${sha}`)
        .set('cookie', cookie)
        .send({ state, context: 'ci' })
        .expect(201);
    const checksOf = (number: number, cookie?: string) => {
      const call = api().get(`${repos}/pulls/${number}`);
      return (cookie ? call.set('cookie', cookie) : call)
        .expect(200)
        .then((response) => response.body.checks);
    };
    const pullCommits = (number: number, cookie: string) =>
      api()
        .get(`${repos}/pulls/${number}/commits`)
        .set('cookie', cookie)
        .expect(200)
        .then((response) => response.body.commits as Commit[]);

    beforeAll(async () => {
      ({ app, origin } = await startApp());
      upstream = await signUp(app, owner);
      forker = await signUp(app, contributor);
      await api()
        .post('/api/repositories')
        .set('cookie', upstream.cookie)
        .send({ name: 'app', visibility: 'public' })
        .expect(201);

      work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-checks-'));
      git('init', '-q', '-b', 'main');
      git('commit', '-q', '--allow-empty', '-m', 'first');
      main = git('rev-parse', 'HEAD');
      same = branch('same');
      branch('quiet');
      await push(owner, upstream.key, 'app', 'main', 'same', 'quiet');

      await api()
        .post(`${repos}/fork`)
        .set('cookie', forker.cookie)
        .send({ name: 'fork', visibility: 'public' })
        .expect(201);
      forked = branch('forked');
      spoof = branch('spoof');
      await push(contributor, forker.key, 'fork', 'forked', 'spoof');
    }, 120_000);

    afterAll(async () => {
      await app?.close();
      if (work) rmSync(work, { recursive: true, force: true });
    });

    it('carries the head’s combined status, null without statuses, and keeps it once merged', async () => {
      withStatus = await openPull(upstream.cookie, 'same');
      const without = await openPull(upstream.cookie, 'quiet');
      await postStatus(repos, upstream.cookie, same);

      expect(await checksOf(withStatus)).toMatchObject({
        sha: same,
        state: 'success',
        totalCount: 1,
        statuses: [
          expect.objectContaining({ context: 'ci', state: 'success' }),
        ],
      });
      expect(await checksOf(without)).toBeNull();

      await api()
        .post(`${repos}/pulls/${withStatus}/merge`)
        .set('cookie', upstream.cookie)
        .send({})
        .expect(201);
      expect(await checksOf(withStatus)).toMatchObject({
        sha: same,
        state: 'success',
      });
    });

    it('attaches status to each commit of a pull request and of the commit lists, null where there is none', async () => {
      const commits = await pullCommits(withStatus, upstream.cookie);
      expect(
        commits.map((commit) => [commit.sha, commit.status?.state ?? null]),
      ).toEqual([[same, 'success']]);

      const { body: list } = await api()
        .get(`${repos}/commits?ref=same`)
        .expect(200);
      expect(
        (list.commits as Commit[]).map((commit) => [
          commit.sha,
          commit.status?.state ?? null,
        ]),
      ).toEqual([
        [same, 'success'],
        [main, null],
      ]);

      const { body: single } = await api()
        .get(`${repos}/commits/${same}`)
        .expect(200);
      expect(single.status).toMatchObject({ sha: same, state: 'success' });
      const { body: root } = await api()
        .get(`${repos}/commits/${main}`)
        .expect(200);
      expect(root.status).toBeNull();
    });

    it('keeps the base repository’s status when the fork posts the same context', async () => {
      const number = await openPull(forker.cookie, `${contributor}:spoof`);
      await postStatus(repos, upstream.cookie, spoof, 'failure');
      await postStatus(forkRepos, forker.cookie, spoof, 'success');

      expect(await checksOf(number, upstream.cookie)).toMatchObject({
        sha: spoof,
        state: 'failure',
        totalCount: 1,
        statuses: [
          expect.objectContaining({ context: 'ci', state: 'failure' }),
        ],
      });
    });

    it('shows a fork’s statuses only to viewers who can read the fork', async () => {
      const number = await openPull(forker.cookie, `${contributor}:forked`);
      await postStatus(forkRepos, forker.cookie, forked);

      expect(await checksOf(number, forker.cookie)).toMatchObject({
        sha: forked,
        state: 'success',
      });
      expect(await checksOf(number, upstream.cookie)).toMatchObject({
        state: 'success',
      });

      await api()
        .patch(forkRepos)
        .set('cookie', forker.cookie)
        .send({ visibility: 'private' })
        .expect(200);

      expect(await checksOf(number, forker.cookie)).toMatchObject({
        state: 'success',
      });
      expect(await checksOf(number, upstream.cookie)).toBeNull();
      expect(await checksOf(number)).toBeNull();
      expect((await pullCommits(number, upstream.cookie))[0].status).toBeNull();
    });
    it('counts only the base repository’s statuses toward a required check', async () => {
      const head = branch('fork-only');
      await push(contributor, forker.key, 'fork', 'fork-only');
      const number = await openPull(forker.cookie, `${contributor}:fork-only`);
      await postStatus(forkRepos, forker.cookie, head);
      await api()
        .post(`${repos}/rulesets`)
        .set('cookie', upstream.cookie)
        .send({
          name: 'ci required',
          target: 'branch',
          enforcement: 'active',
          include: ['~DEFAULT_BRANCH'],
          exclude: [],
          bypassActors: [],
          rules: [
            {
              type: 'required_status_checks',
              parameters: { required_status_checks: [{ context: 'ci' }] },
            },
          ],
        })
        .expect(201);
      const unmet = async () =>
        (
          await api()
            .get(`${repos}/pulls/${number}/merge-requirements`)
            .set('cookie', upstream.cookie)
            .expect(200)
        ).body.violations.map(
          ({ requirement }: { requirement: string }) => requirement,
        );

      expect(await unmet()).toEqual(['status_checks']);
      await postStatus(repos, upstream.cookie, head);
      expect(await unmet()).toEqual([]);
    });
  },
);
