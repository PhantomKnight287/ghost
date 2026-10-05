import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, signUp, startApp } from './harness.js';

/** A push git would refuse must never reach the log: once there, every clone of the repository fails for good. */
describe.skipIf(!hasBackends)('pushes the log could not replay', () => {
  let app: INestApplication;
  let origin: string;
  let owner: { cookie: string; key: string };
  let work: string;
  const username = `pushcheck${Date.now()}`;
  let repo: string;
  let first: string;

  const remote = () =>
    `${origin.replace('://', `://${username}:${owner.key}@`)}/${username}/${repo}.git`;
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
      { cwd: work, encoding: 'utf8' },
    ).trim();
  // The server runs in this process, so anything that talks to it must not block the event loop.
  const run = (...args: string[]) =>
    promisify(execFile)('git', args, {
      cwd: work,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  /** A receive-pack request git itself would never send: one ref update and whatever pack the test hands it. */
  const rawPush = (ref: string, oid: string, pack: Buffer) => {
    const command = `${'0'.repeat(40)} ${oid} ${ref}\0report-status\n`;
    const line = `${(Buffer.byteLength(command) + 4).toString(16).padStart(4, '0')}${command}`;
    return fetch(`${origin}/${username}/${repo}/git-receive-pack`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${username}:${owner.key}`).toString('base64')}`,
        'content-type': 'application/x-git-receive-pack-request',
      },
      body: Buffer.concat([Buffer.from(`${line}0000`), pack]),
    });
  };
  const stillClones = async () => {
    const target = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-clone-'));
    try {
      await run('clone', '-q', remote(), target);
      return execFileSync('git', ['-C', target, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim();
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  };

  beforeAll(async () => {
    ({ app, origin } = await startApp());
    owner = await signUp(app, username);
    repo = (
      await request(app.getHttpServer())
        .post('/api/repositories')
        .set('cookie', owner.cookie)
        .send({ name: 'guarded', visibility: 'public' })
        .expect(201)
    ).body.slug;

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-push-check-'));
    git('init', '-q', '-b', 'main');
    writeFileSync(path.join(work, 'a.txt'), 'a\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    first = git('rev-parse', 'HEAD');
    await run('push', '-q', remote(), 'main');
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('refuses a ref at an object the push never carried, and the repository still clones', async () => {
    const emptyPack = Buffer.concat([
      Buffer.from('PACK'),
      Buffer.from([0, 0, 0, 2, 0, 0, 0, 0]),
    ]);
    const response = await rawPush(
      'refs/heads/evil',
      'ab'.repeat(20),
      emptyPack,
    );

    expect(response.ok).toBe(true);
    expect(await response.text()).toContain('ng refs/heads/evil ');
    expect(await stillClones()).toBe(first);
  });

  it('refuses a branch at a tree', async () => {
    const response = await rawPush(
      'refs/heads/tree',
      git('rev-parse', 'HEAD^{tree}'),
      Buffer.alloc(0),
    );

    expect(response.ok).toBe(true);
    expect(await response.text()).toMatch(
      /ng refs\/heads\/tree .*must point at a commit/,
    );
    expect(await stillClones()).toBe(first);
  });

  it('refuses a branch beneath an existing one, and the repository still clones', async () => {
    await expect(
      run('push', '-q', remote(), 'main:refs/heads/main/nested'),
    ).rejects.toThrow(
      /\[remote rejected\] main -> main\/nested \(.*conflicts with refs\/heads\/main/,
    );
    expect(await stillClones()).toBe(first);
  });

  it('still takes an ordinary thin push, and serves it', async () => {
    writeFileSync(path.join(work, 'a.txt'), 'a, again\n');
    git('commit', '-q', '-am', 'second');
    await run('push', '-q', remote(), 'main');

    expect(await stillClones()).toBe(git('rev-parse', 'HEAD'));
  });
});
