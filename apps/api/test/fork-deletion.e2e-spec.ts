import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)(
  'pull requests outlive the fork they came from',
  () => {
    let app: INestApplication;
    let origin: string;
    let upstream: { cookie: string; key: string };
    let forker: { cookie: string; key: string };
    let work: string;
    const owner = `upstream${Date.now()}`;
    const contributor = `forker${Date.now()}`;
    let repo: string;
    let fork: string;

    const api = () => request(app.getHttpServer());
    const repos = `/api/repositories/${owner}/`;
    const pull = (suffix: string) => `${repos}${repo}/pulls/${suffix}`;
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
    const deleteFork = () =>
      api()
        .delete(`/api/repositories/${contributor}/${fork}`)
        .set('cookie', forker.cookie);
    const openPull = (head: string) =>
      api()
        .post(`${repos}${repo}/pulls`)
        .set('cookie', forker.cookie)
        .send({ title: head, base: 'main', head: `${contributor}:${head}` })
        .expect(201)
        .then((response) => response.body.number as number);

    beforeAll(async () => {
      ({ app, origin } = await startApp());
      upstream = await signUp(app, owner);
      forker = await signUp(app, contributor);

      repo = (
        await api()
          .post('/api/repositories')
          .set('cookie', upstream.cookie)
          .send({ name: 'upstream', visibility: 'public' })
          .expect(201)
      ).body.slug;
      work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-fork-'));
      git('init', '-q', '-b', 'main');
      git('commit', '-q', '--allow-empty', '-m', 'first');
      await push(owner, upstream.key, repo, 'main');

      fork = (
        await api()
          .post(`${repos}${repo}/fork`)
          .set('cookie', forker.cookie)
          .send({ name: 'fork', visibility: 'public' })
          .expect(201)
      ).body.slug;
      for (const branch of ['feature', 'abandoned']) {
        git('checkout', '-q', '-b', branch, 'main');
        git('commit', '-q', '--allow-empty', '-m', branch);
      }
      await push(contributor, forker.key, fork, 'feature', 'abandoned');
    }, 120_000);

    afterAll(async () => {
      await app?.close();
      if (work) rmSync(work, { recursive: true, force: true });
    });

    it('refuses to delete a fork while it heads an open pull request', async () => {
      const number = await openPull('feature');

      const { body } = await deleteFork().expect(409);
      expect(body.message).toContain(`${owner}/${repo}#${number}`);
    });

    it('deletes the fork once its pull requests are merged or closed, and keeps them', async () => {
      const abandoned = await openPull('abandoned');
      await api()
        .post(pull('1/merge'))
        .set('cookie', upstream.cookie)
        .send({})
        .expect(201);
      await api()
        .patch(pull(`${abandoned}/close`))
        .set('cookie', forker.cookie)
        .expect(200);

      await deleteFork().expect(204);

      const merged = await api().get(pull('1')).expect(200);
      expect(merged.body).toMatchObject({
        state: 'merged',
        head: { username: null, slug: null, ref: 'feature' },
        commitCount: 1,
      });
      const commits = await api().get(pull('1/commits')).expect(200);
      expect(
        commits.body.commits.map((c: { subject: string }) => c.subject),
      ).toEqual(['feature']);

      const closed = await api()
        .get(pull(`${abandoned}`))
        .expect(200);
      expect(closed.body).toMatchObject({
        state: 'closed',
        head: { username: null, ref: 'abandoned' },
        commitCount: 0,
      });
      await api()
        .get(pull(`${abandoned}/patch`))
        .expect(410);
    });
  },
);
