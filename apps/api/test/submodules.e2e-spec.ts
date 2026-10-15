import { execFile, execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)('repositories with submodules', () => {
  const web = 'https://web.example';
  const username = `submodules${Date.now()}`;
  let app: INestApplication;
  let owner: { cookie: string; key: string; userId: string };
  let work: string;
  let remote: (repo: string) => string;
  let libFirst: string;
  let libSecond: string;
  let bump: string;
  const http = () => request(app.getHttpServer());

  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
      {
        cwd,
        encoding: 'utf8',
      },
    ).trim();
  // The server runs in this process, so a git that talks to it must not block the event loop.
  const gitAsync = (cwd: string, ...args: string[]) =>
    promisify(execFile)(
      'git',
      ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
      {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      },
    );

  beforeAll(async () => {
    let origin: string;
    ({ app, origin } = await startApp({ WEB_APP_URL: web }));
    owner = await signUp(app, username);
    remote = (repo) =>
      `${origin.replace('://', `://${username}:${owner.key}@`)}/${username}/${repo}.git`;
    for (const name of ['lib', 'app']) {
      await http()
        .post('/api/repositories')
        .set('cookie', owner.cookie)
        .send({ name, visibility: 'private' })
        .expect(201);
    }

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-submodules-'));
    const lib = path.join(work, 'lib');
    const superproject = path.join(work, 'app');

    git(work, 'init', '-q', '-b', 'main', lib);
    writeFileSync(path.join(lib, 'lib.txt'), 'one\n');
    git(lib, 'add', '.');
    git(lib, 'commit', '-q', '-m', 'lib one');
    libFirst = git(lib, 'rev-parse', 'HEAD');
    writeFileSync(path.join(lib, 'lib.txt'), 'two\n');
    git(lib, 'commit', '-q', '-am', 'lib two');
    libSecond = git(lib, 'rev-parse', 'HEAD');
    await gitAsync(lib, 'push', '-q', remote('lib'), 'main');

    // The gitlink is written straight into the index, so the superproject never fetches from the server it is about to push to.
    git(work, 'init', '-q', '-b', 'main', superproject);
    writeFileSync(path.join(superproject, 'README.md'), 'app\n');
    writeFileSync(
      path.join(superproject, '.gitmodules'),
      '[submodule "lib"]\n\tpath = vendor/lib\n\turl = ../lib.git\n',
    );
    git(superproject, 'add', '.');
    git(
      superproject,
      'update-index',
      '--add',
      '--cacheinfo',
      `160000,${libFirst},vendor/lib`,
    );
    git(superproject, 'commit', '-q', '-m', 'add lib');
    git(
      superproject,
      'update-index',
      '--cacheinfo',
      `160000,${libSecond},vendor/lib`,
    );
    git(superproject, 'commit', '-q', '-m', 'bump lib');
    bump = git(superproject, 'rev-parse', 'HEAD');
    await gitAsync(
      superproject,
      'push',
      '-q',
      remote('app'),
      'HEAD~1:refs/heads/main',
    );

    git(superproject, 'checkout', '-q', '-b', 'orphan');
    git(
      superproject,
      'update-index',
      '--add',
      '--cacheinfo',
      `160000,${libFirst},vendor/orphan`,
    );
    git(superproject, 'commit', '-q', '-m', 'gitlink missing from .gitmodules');
    git(superproject, 'checkout', '-q', 'main');
    await gitAsync(superproject, 'push', '-q', remote('app'), 'orphan');
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  const contents = (query: Record<string, string>) =>
    http()
      .get(`/api/repositories/${username}/app/contents`)
      .set('cookie', owner.cookie)
      .query(query)
      .expect(200);

  it('lists a submodule with its URL and a link to the repository at the pinned commit', async () => {
    const { body } = await contents({ path: 'vendor' });

    expect(body.entries).toEqual([
      expect.objectContaining({
        name: 'lib',
        type: 'commit',
        oid: libFirst,
        size: null,
        submodule: {
          url: '../lib.git',
          href: `${web}/${username}/lib/tree/${libFirst}`,
        },
      }),
    ]);
  });

  it('lists a gitlink that .gitmodules does not name without submodule details', async () => {
    const { body } = await contents({ path: 'vendor', ref: 'orphan' });

    expect(body.entries).toEqual([
      expect.objectContaining({ name: 'lib', submodule: expect.anything() }),
      expect.objectContaining({
        name: 'orphan',
        type: 'commit',
        submodule: null,
      }),
    ]);
  });

  it('lists it the same way at a commit, where the path index is not used', async () => {
    const tip = git(path.join(work, 'app'), 'rev-parse', 'HEAD~1');
    const { body } = await contents({ path: 'vendor', ref: tip });

    expect(body.entries).toEqual([
      expect.objectContaining({
        name: 'lib',
        lastCommit: null,
        submodule: expect.objectContaining({ url: '../lib.git' }),
      }),
    ]);
  });

  it('leaves files without submodule details', async () => {
    const { body } = await contents({});
    const readme = body.entries.find(
      (entry: { name: string }) => entry.name === 'README.md',
    );

    expect(readme).toMatchObject({ type: 'blob', submodule: null });
  });

  it('clones with the submodule checked out at the pinned commit, then follows a pushed bump', async () => {
    const clone = path.join(work, 'clone');
    await gitAsync(
      work,
      'clone',
      '-q',
      '--recurse-submodules',
      remote('app'),
      clone,
    );

    expect(git(path.join(clone, 'vendor/lib'), 'rev-parse', 'HEAD')).toBe(
      libFirst,
    );
    expect(readFileSync(path.join(clone, 'vendor/lib/lib.txt'), 'utf8')).toBe(
      'one\n',
    );

    await gitAsync(path.join(work, 'app'), 'push', '-q', remote('app'), 'main');
    await gitAsync(clone, 'pull', '-q', '--recurse-submodules');

    expect(git(path.join(clone, 'vendor/lib'), 'rev-parse', 'HEAD')).toBe(
      libSecond,
    );
  });

  it('describes a submodule bump in a commit by the commits on each side', async () => {
    await gitAsync(path.join(work, 'app'), 'push', '-q', remote('app'), 'main');
    const { body } = await http()
      .get(`/api/repositories/${username}/app/commits/${bump}`)
      .set('cookie', owner.cookie)
      .expect(200);

    expect(body.files).toEqual([
      {
        status: 'M',
        path: 'vendor/lib',
        submodule: { from: libFirst, to: libSecond },
      },
    ]);
  });

  it('archives a submodule as an empty folder, as git archive does', async () => {
    const zip = await http()
      .get(`/api/repositories/${username}/app/archive`)
      .set('cookie', owner.cookie)
      .query({ format: 'zip' })
      .responseType('blob')
      .expect(200);
    const archive = path.join(work, 'app.zip');
    writeFileSync(archive, zip.body as Buffer);
    const extracted = path.join(work, 'extracted');
    execFileSync('unzip', ['-q', archive, '-d', extracted]);

    expect(existsSync(path.join(extracted, 'app-main/README.md'))).toBe(true);
    expect(existsSync(path.join(extracted, 'app-main/vendor/lib'))).toBe(true);
    expect(
      existsSync(path.join(extracted, 'app-main/vendor/lib/lib.txt')),
    ).toBe(false);
  });
});
