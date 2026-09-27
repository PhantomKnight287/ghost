import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)('squash and rebase merges', () => {
  let app: INestApplication;
  let origin: string;
  let owner: { cookie: string; key: string };
  let work: string;
  const username = `merger${Date.now()}`;
  let repo: string;

  const api = () => request(app.getHttpServer());
  const pulls = (suffix = '') =>
    `/api/repositories/${username}/${repo}/pulls${suffix}`;
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Branch Author',
        '-c',
        'user.email=branch@example.com',
        ...args,
      ],
      { cwd: work, encoding: 'utf8' },
    ).trim();
  // The server runs in this process, so anything that talks to it must not block the event loop.
  const remote = (verb: 'push' | 'fetch', ...refs: string[]) =>
    promisify(execFile)(
      'git',
      [
        verb,
        '-q',
        `${origin.replace('://', `://${username}:${owner.key}@`)}/${username}/${repo}.git`,
        ...refs,
      ],
      { cwd: work, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
  const branch = (name: string, files: Record<string, string>) => {
    git('checkout', '-q', '-b', name, 'main');
    for (const [file, content] of Object.entries(files)) {
      writeFileSync(path.join(work, file), content);
      git('add', file);
      git(
        'commit',
        '-q',
        '-m',
        `edit ${file}`,
        '-m',
        `closes nothing in ${file}`,
      );
    }
  };
  const open = (head: string) =>
    api()
      .post(pulls())
      .set('cookie', owner.cookie)
      .send({ title: `Land ${head}`, base: 'main', head })
      .expect(201)
      .then((response) => response.body.number as number);
  const merge = (number: number, method: string) =>
    api()
      .post(pulls(`/${number}/merge`))
      .set('cookie', owner.cookie)
      .send({ method });
  const mainTip = async () => {
    await remote('fetch', 'main:refs/remotes/server/main');
    return 'refs/remotes/server/main';
  };

  beforeAll(async () => {
    ({ app, origin } = await startApp());
    owner = await signUp(app, username);
    repo = (
      await api()
        .post('/api/repositories')
        .set('cookie', owner.cookie)
        .send({ name: 'methods', visibility: 'public' })
        .expect(201)
    ).body.slug;

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-methods-'));
    git('init', '-q', '-b', 'main');
    writeFileSync(path.join(work, 'shared.txt'), 'shared\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    branch('squashed', { 'a.txt': 'a\n', 'b.txt': 'b\n' });
    branch('rebased', { 'c.txt': 'c\n', 'd.txt': 'd\n' });
    branch('clashing', { 'shared.txt': 'from the branch\n' });
    git('checkout', '-q', 'main');
    writeFileSync(path.join(work, 'shared.txt'), 'from main\n');
    git('commit', '-q', '-am', 'main moves on');
    await remote('push', 'main', 'squashed', 'rebased', 'clashing');
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('refuses a method it does not know', async () => {
    const number = await open('squashed');
    await merge(number, 'octopus').expect(400);
  });

  it('squashes the request into one commit credited to its author, and keeps its commits readable', async () => {
    const { body } = await merge(1, 'squash').expect(201);
    const tip = await mainTip();

    expect(git('rev-parse', tip)).toBe(body.mergeCommitSha);
    expect(git('log', '-1', '--format=%P', tip).split(' ')).toHaveLength(1);
    expect(git('log', '-1', '--format=%s', tip)).toBe('Land squashed (#1)');
    expect(git('log', '-1', '--format=%ae', tip)).toBe(
      `${username}@example.com`,
    );
    expect(git('log', '-1', '--format=%b', tip)).toContain(
      '* edit a.txt\n\ncloses nothing in a.txt',
    );
    expect(git('ls-tree', '--name-only', tip).split('\n')).toEqual([
      'a.txt',
      'b.txt',
      'shared.txt',
    ]);

    const commits = await api().get(pulls('/1/commits')).expect(200);
    expect(
      commits.body.commits.map((commit: { subject: string }) => commit.subject),
    ).toEqual(['edit b.txt', 'edit a.txt']);
    const files = await api().get(pulls('/1/files')).expect(200);
    expect(files.body.files.map((file: { path: string }) => file.path)).toEqual(
      ['a.txt', 'b.txt'],
    );
  });

  it('rebases each commit onto the base, keeping its author', async () => {
    const number = await open('rebased');
    const before = git('rev-parse', await mainTip());

    const { body } = await merge(number, 'rebase').expect(201);
    const tip = await mainTip();
    expect(git('rev-parse', tip)).toBe(body.mergeCommitSha);
    expect(git('log', '--format=%s|%an|%P', `${before}..${tip}`)).toBe(
      [
        `edit d.txt|Branch Author|${git('rev-parse', `${tip}^`)}`,
        `edit c.txt|Branch Author|${before}`,
      ].join('\n'),
    );

    const pull = await api()
      .get(pulls(`/${number}`))
      .expect(200);
    expect(pull.body.state).toBe('merged');
    expect(pull.body.commitCount).toBe(2);
  });

  it('rejects a rebase that conflicts and names the path', async () => {
    const number = await open('clashing');
    const { body } = await merge(number, 'rebase').expect(409);
    expect(body.message).toContain('shared.txt');
    expect(
      (
        await api()
          .get(pulls(`/${number}`))
          .expect(200)
      ).body.state,
    ).toBe('open');
  });

  it('refuses a rebase whose head holds nothing but merge commits', async () => {
    const tip = git('rev-parse', await mainTip());
    const mergeOnly = git(
      'commit-tree',
      `${tip}^{tree}`,
      '-p',
      tip,
      '-p',
      `${tip}^`,
      '-m',
      'merge only',
    );
    await remote('push', `${mergeOnly}:refs/heads/merges-only`);

    const number = await open('merges-only');
    const { body } = await merge(number, 'rebase').expect(409);
    expect(body.message).toContain('already contains');
  });
});
