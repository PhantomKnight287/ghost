import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { hasBackends, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)('refs/pull/<n>/head and /merge', () => {
  let app: INestApplication;
  let origin: string;
  let upstream: { cookie: string; key: string };
  let forker: { cookie: string; key: string };
  let work: string;
  const owner = `pullrefs${Date.now()}`;
  const contributor = `pullfork${Date.now()}`;
  let repo: string;
  let fork: string;

  const api = () => request(app.getHttpServer());
  const pulls = (suffix = '') =>
    `/api/repositories/${owner}/${repo}/pulls${suffix}`;
  const url = (username: string, key: string, slug: string) =>
    `${origin.replace('://', `://${username}:${key}@`)}/${username}/${slug}.git`;
  const upstreamUrl = () => url(owner, upstream.key, repo);
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
      { cwd: work, encoding: 'utf8' },
    ).trim();
  // The server runs in this process, so anything that talks to it must not block the event loop.
  const run = (args: string[], env: Record<string, string> = {}) =>
    promisify(execFile)('git', args, {
      cwd: work,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
    });
  const commit = (branch: string, file: string, content: string) => {
    git('checkout', '-q', branch);
    writeFileSync(path.join(work, file), content);
    git('add', file);
    git('commit', '-q', '-m', `${branch}: ${file}`);
    return git('rev-parse', 'HEAD');
  };
  const pullRefs = async (target = upstreamUrl()) => {
    const { stdout } = await run(['ls-remote', target, 'refs/pull/*']);
    return Object.fromEntries(
      stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split('\t').reverse()),
    ) as Record<string, string>;
  };
  const fetchRef = async (ref: string) => {
    await run(['fetch', '-q', upstreamUrl(), `+${ref}:refs/fetched/${ref}`]);
    return `refs/fetched/${ref}`;
  };
  const parentsOf = async (ref: string) =>
    git('log', '-1', '--format=%P', await fetchRef(ref)).split(' ');

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
    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-pull-refs-'));
    git('init', '-q', '-b', 'main');
    writeFileSync(path.join(work, 'shared.txt'), 'shared\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    await run(['push', '-q', upstreamUrl(), 'main']);

    fork = (
      await api()
        .post(`/api/repositories/${owner}/${repo}/fork`)
        .set('cookie', forker.cookie)
        .send({ name: 'fork', visibility: 'public' })
        .expect(201)
    ).body.slug;
    git('checkout', '-q', '-b', 'feature', 'main');
    git('checkout', '-q', '-b', 'other', 'main');
    commit('feature', 'feature.txt', 'from the fork\n');
    commit('other', 'other.txt', 'another change\n');
    await run([
      'push',
      '-q',
      url(contributor, forker.key, fork),
      'feature',
      'other',
    ]);

    await api()
      .post(pulls())
      .set('cookie', forker.cookie)
      .send({ title: 'feature', base: 'main', head: `${contributor}:feature` })
      .expect(201);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('publishes a fork request as its head and a test merge into the base', async () => {
    const feature = git('rev-parse', 'feature');
    const main = git('rev-parse', 'main');

    await vi.waitFor(
      async () => {
        const refs = await pullRefs();
        expect(refs['refs/pull/1/head']).toBe(feature);
        expect(refs['refs/pull/1/merge']).toBeDefined();
      },
      { timeout: 15_000, interval: 200 },
    );

    expect(await parentsOf('refs/pull/1/merge')).toEqual([main, feature]);
    expect(
      git('ls-tree', '--name-only', 'refs/fetched/refs/pull/1/merge').split(
        '\n',
      ),
    ).toEqual(['feature.txt', 'shared.txt']);
  });

  it('fetches over protocol v2, asking only for the prefix it wants', async () => {
    const { stderr } = await run(
      [
        '-c',
        'protocol.version=2',
        'fetch',
        upstreamUrl(),
        '+refs/pull/1/head:refs/fetched/v2',
      ],
      { GIT_TRACE_PACKET: '1' },
    );

    expect(stderr).toContain('version 2');
    expect(stderr).toContain('ref-prefix refs/pull/1/head');
    expect(stderr).not.toContain('refs/heads/main');
    expect(git('rev-parse', 'refs/fetched/v2')).toBe(
      git('rev-parse', 'feature'),
    );
  });

  it('follows the head when the fork pushes again', async () => {
    const feature = commit('feature', 'feature.txt', 'from the fork, again\n');
    await run(['push', '-q', url(contributor, forker.key, fork), 'feature']);

    await vi.waitFor(
      async () => expect((await pullRefs())['refs/pull/1/head']).toBe(feature),
      { timeout: 15_000, interval: 200 },
    );
    await vi.waitFor(
      async () =>
        expect(await parentsOf('refs/pull/1/merge')).toEqual([
          git('rev-parse', 'main'),
          feature,
        ]),
      { timeout: 15_000, interval: 200 },
    );
  });

  it('rebuilds the test merge when the base moves', async () => {
    const main = commit('main', 'upstream.txt', 'upstream moves on\n');
    await run(['push', '-q', upstreamUrl(), 'main']);

    await vi.waitFor(
      async () =>
        expect(await parentsOf('refs/pull/1/merge')).toEqual([
          main,
          git('rev-parse', 'feature'),
        ]),
      { timeout: 15_000, interval: 200 },
    );
  });

  it('drops the test merge while the request conflicts, and keeps the head', async () => {
    commit('main', 'feature.txt', 'the base claims this file\n');
    await run(['push', '-q', upstreamUrl(), 'main']);

    await vi.waitFor(
      async () => {
        const refs = await pullRefs();
        expect(refs['refs/pull/1/merge']).toBeUndefined();
        expect(refs['refs/pull/1/head']).toBe(git('rev-parse', 'feature'));
      },
      { timeout: 15_000, interval: 200 },
    );
  });

  it('refuses a client push to a pull request ref', async () => {
    await expect(
      run(['push', '-q', upstreamUrl(), 'main:refs/pull/1/head']),
    ).rejects.toThrow();
    expect((await pullRefs())['refs/pull/1/head']).toBe(
      git('rev-parse', 'feature'),
    );
  });

  it('pins a merged request to the head that merged', async () => {
    const other = git('rev-parse', 'other');
    const { body } = await api()
      .post(pulls())
      .set('cookie', forker.cookie)
      .send({ title: 'other', base: 'main', head: `${contributor}:other` })
      .expect(201);
    await api()
      .post(pulls(`/${body.number}/merge`))
      .set('cookie', upstream.cookie)
      .send({ method: 'squash' })
      .expect(201);

    await vi.waitFor(
      async () =>
        expect((await pullRefs())[`refs/pull/${body.number}/head`]).toBe(other),
      { timeout: 15_000, interval: 200 },
    );
  });

  it('leaves pull request refs behind when the repository is forked', async () => {
    const username = `pulllate${Date.now()}`;
    const later = await signUp(app, username);
    const { body } = await api()
      .post(`/api/repositories/${owner}/${repo}/fork`)
      .set('cookie', later.cookie)
      .send({ name: 'late', visibility: 'public' })
      .expect(201);

    expect(await pullRefs(url(username, later.key, body.slug))).toEqual({});
  });
});
