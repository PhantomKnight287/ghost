import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, signUp, startApp } from './harness.js';

/** `git push` tells whoever pushed a branch where its pull request is, or how to open one. */
describe.skipIf(!hasBackends)('pull request hints on push', () => {
  let app: INestApplication;
  let origin: string;
  let upstream: { cookie: string; key: string };
  let forker: { cookie: string; key: string };
  let work: string;
  const owner = `hinted${Date.now()}`;
  const contributor = `hintfork${Date.now()}`;
  const web = 'https://web.example';
  let repo: string;
  let fork: string;

  const api = () => request(app.getHttpServer());
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
      { cwd: work, encoding: 'utf8' },
    ).trim();
  /** What git printed as `remote:` lines. The server runs in this process, so the push must not block the event loop. */
  const push = async (
    username: string,
    key: string,
    slug: string,
    ...refs: string[]
  ) => {
    const { stderr } = await promisify(execFile)(
      'git',
      [
        'push',
        `${origin.replace('://', `://${username}:${key}@`)}/${username}/${slug}.git`,
        ...refs,
      ],
      { cwd: work, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
    return stderr
      .split('\n')
      .filter((line) => line.startsWith('remote:'))
      .join('\n');
  };
  const branch = (name: string) => {
    git('checkout', '-q', '-b', name, 'main');
    git('commit', '-q', '--allow-empty', '-m', name);
  };

  beforeAll(async () => {
    ({ app, origin } = await startApp({ WEB_APP_URL: web }));
    upstream = await signUp(app, owner);
    forker = await signUp(app, contributor);
    repo = (
      await api()
        .post('/api/repositories')
        .set('cookie', upstream.cookie)
        .send({ name: 'hinted', visibility: 'public' })
        .expect(201)
    ).body.slug;

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-hints-'));
    git('init', '-q', '-b', 'main');
    git('commit', '-q', '--allow-empty', '-m', 'first');
    await push(owner, upstream.key, repo, 'main');
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('says nothing about the default branch', async () => {
    git('checkout', '-q', 'main');
    git('commit', '-q', '--allow-empty', '-m', 'second');

    expect(await push(owner, upstream.key, repo, 'main')).not.toContain(
      'pull request',
    );
  });

  it('links a new branch to the form and the gh command that open its pull request', async () => {
    branch('feature');

    const remote = await push(owner, upstream.key, repo, 'feature');

    expect(remote).toContain(
      `Create a pull request for 'feature' on Ghost by visiting:`,
    );
    expect(remote).toContain(
      `${web}/${owner}/${repo}/pulls/new?base=main&head=feature`,
    );
    expect(remote).toContain(
      `gh pr create --repo 127.0.0.1/${owner}/${repo} --base main --head feature`,
    );
  });

  it('links a branch to the pull request it already heads', async () => {
    const { number } = (
      await api()
        .post(`/api/repositories/${owner}/${repo}/pulls`)
        .set('cookie', upstream.cookie)
        .send({ title: 'Feature', base: 'main', head: 'feature' })
        .expect(201)
    ).body as { number: number };
    git('commit', '-q', '--allow-empty', '-m', 'more');

    const remote = await push(owner, upstream.key, repo, 'feature');

    expect(remote).toContain(`View the pull request for 'feature' on Ghost:`);
    expect(remote).toContain(`${web}/${owner}/${repo}/pull/${number}`);
    expect(remote).not.toContain('Create a pull request');
  });

  it('quotes a branch name the shell would read', async () => {
    branch('odd$name');

    const remote = await push(owner, upstream.key, repo, 'odd$name');

    expect(remote).toContain('head=odd%24name');
    expect(remote).toContain(`--head 'odd$name'`);
  });

  it('says nothing when a branch is deleted', async () => {
    expect(await push(owner, upstream.key, repo, ':odd$name')).not.toContain(
      'pull request',
    );
  });

  it('proposes a fork branch to the repository it was forked from', async () => {
    fork = (
      await api()
        .post(`/api/repositories/${owner}/${repo}/fork`)
        .set('cookie', forker.cookie)
        .send({ name: 'fork', visibility: 'public' })
        .expect(201)
    ).body.slug;
    branch('topic');

    const remote = await push(contributor, forker.key, fork, 'topic');

    expect(remote).toContain(
      `${web}/${owner}/${repo}/pulls/new?base=main&head=${contributor}%3Atopic`,
    );
    expect(remote).toContain(
      `gh pr create --repo 127.0.0.1/${owner}/${repo} --base main --head ${contributor}:topic`,
    );
  });
});
