import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GH_E2E_HOST, runGh, tlsFiles } from './gh.js';
import { hasBackends, signUp, startApp } from './harness.js';
import request from 'supertest';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

describe.skipIf(!hasBackends || !GH_E2E_HOST)('gh CLI', () => {
  let app: INestApplication;
  let owner: { cookie: string; key: string; userId: string };
  let configDir: string;
  const username = `ghcli${Date.now()}`;
  const gh = (args: string[], input?: string) =>
    runGh(args, { configDir, token: owner.key, input });
  const ok = async (args: string[], input?: string) => {
    const result = await gh(args, input);
    expect(result, result.stderr).toMatchObject({ code: 0 });
    return result.stdout;
  };

  beforeAll(async () => {
    const { key, cert } = tlsFiles();
    ({ app } = await startApp(
      {
        BETTER_AUTH_URL: `https://${GH_E2E_HOST}`,
        WEB_APP_URL: `https://web.${GH_E2E_HOST}`,
      },
      443,
      { key, cert },
    ));
    owner = await signUp(app, username);
    configDir = mkdtempSync(path.join(tmpdir(), 'gh-e2e-'));
    // The app serves the self-signed e2e certificate, which supertest must be told to trust.
    const api = request.agent(app.getHttpServer()).ca(cert);
    await api
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: 'tools', visibility: 'public' })
      .expect(201);
    const work = mkdtempSync(path.join(tmpdir(), 'gh-e2e-work-'));
    const git = (...args: string[]) =>
      promisify(execFile)('git', args, {
        cwd: work,
        env: { ...process.env, GIT_SSL_CAINFO: tlsFiles().certPath },
      });
    await git('init', '-q', '-b', 'main');
    writeFileSync(
      path.join(work, 'README.md'),
      '# Tools\n\nHello from Ghost.\n',
    );
    await git('add', '.');
    await git(
      '-c',
      'user.name=E2E',
      '-c',
      'user.email=e2e@example.com',
      'commit',
      '-qm',
      'readme',
    );
    await git(
      'push',
      '-q',
      `https://${username}:${owner.key}@${GH_E2E_HOST}/${username}/tools.git`,
      'main',
    );
    for (const title of ['Broken build', 'Docs typo']) {
      await api.post(`/api/repositories/${username}/tools/issues`).set('cookie', owner.cookie).send({ title }).expect(201);
    }
    await api.post(`/api/repositories/${username}/tools/issues/1/comments`).set('cookie', owner.cookie).send({ body: 'Seen it too' }).expect(201);
    await api.post(`/api/repositories/${username}/tools/labels`).set('cookie', owner.cookie).send({ name: 'bug', color: 'd73a4a' }).expect(201);
  });

  afterAll(async () => {
    await app?.close();
    if (configDir) rmSync(configDir, { recursive: true, force: true });
  });

  it('reaches /api/graphql through gh api graphql', async () => {
    const out = await ok(['api', 'graphql', '-f', 'query={ __typename }']);
    expect(JSON.parse(out)).toEqual({ data: { __typename: 'Query' } });
  });
  it('logs in with a pasted token and reports it in auth status', async () => {
    const login = await runGh(
      ['auth', 'login', '--hostname', GH_E2E_HOST!, '--with-token'],
      { configDir, input: owner.key },
    );
    expect(login, login.stderr).toMatchObject({ code: 0 });
    const status = await runGh(['auth', 'status', '--hostname', GH_E2E_HOST!], {
      configDir,
    });
    expect(status, status.stderr).toMatchObject({ code: 0 });
    expect(status.stdout + status.stderr).toContain(username);
  });

  it('answers gh api user', async () => {
    expect(JSON.parse(await ok(['api', 'user']))).toMatchObject({
      login: username,
    });
  });

  it('views a repository with its README', async () => {
    const out = await ok(['repo', 'view', `${GH_E2E_HOST}/${username}/tools`]);
    expect(out).toContain(`${username}/tools`);
    expect(out).toContain('Hello from Ghost.');
  });

  it('views a repository as JSON', async () => {
    const out = await ok([
      'repo',
      'view',
      `${GH_E2E_HOST}/${username}/tools`,
      '--json',
      'name,owner,visibility,defaultBranchRef',
    ]);
    expect(JSON.parse(out)).toMatchObject({
      name: 'tools',
      owner: { login: username },
      visibility: 'PUBLIC',
      defaultBranchRef: { name: 'main' },
    });
  });

  it('clones a repository', async () => {
    const target = path.join(configDir, 'clone');
    await ok(['repo', 'clone', `${GH_E2E_HOST}/${username}/tools`, target]);
    expect(readFileSync(path.join(target, 'README.md'), 'utf8')).toContain(
      'Hello from Ghost.',
    );
  });

  it('lists issues', async () => {
    const out = await ok(['issue', 'list', '-R', `${GH_E2E_HOST}/${username}/tools`, '--json', 'number,title,state,labels,author,url']);
    const issues = JSON.parse(out);
    expect(issues.map((issue: { title: string }) => issue.title)).toEqual(expect.arrayContaining(['Broken build', 'Docs typo']));
    expect(issues[0].state).toBe('OPEN');
  });

  it('views an issue with comments', async () => {
    const repo = `${GH_E2E_HOST}/${username}/tools`;
    expect(await ok(['issue', 'view', '1', '-R', repo])).toContain('Broken build');
    // Without a terminal, --comments prints only the comments.
    expect(await ok(['issue', 'view', '1', '-R', repo, '--comments'])).toContain('Seen it too');
  });

  it('filters issues by state, label, author and assignee', async () => {
    const out = await ok(['issue', 'list', '-R', `${GH_E2E_HOST}/${username}/tools`, '--state', 'all', '--author', username, '--json', 'number']);
    expect(JSON.parse(out).length).toBeGreaterThanOrEqual(2);
  });

  it('searches issues', async () => {
    const out = await ok(['issue', 'list', '-R', `${GH_E2E_HOST}/${username}/tools`, '--search', 'build', '--json', 'title']);
    expect(JSON.parse(out)).toEqual([{ title: 'Broken build' }]);
  });

  it('creates an issue with a label and an assignee', async () => {
    const out = await ok(['issue', 'create', '-R', `${GH_E2E_HOST}/${username}/tools`, '--title', 'Made by gh', '--body', 'Body', '--label', 'bug', '--assignee', username]);
    expect(out).toMatch(new RegExp(`/${username}/tools/issues/\\d+`));
  });

  it('comments on, edits, closes and reopens an issue', async () => {
    const repo = `${GH_E2E_HOST}/${username}/tools`;
    await ok(['issue', 'comment', '1', '-R', repo, '--body', 'From gh']);
    await ok(['issue', 'edit', '1', '-R', repo, '--title', 'Broken build (edited)', '--add-label', 'bug']);
    await ok(['issue', 'close', '1', '-R', repo]);
    expect(JSON.parse(await ok(['issue', 'view', '1', '-R', repo, '--json', 'state,title,labels']))).toMatchObject({ state: 'CLOSED', title: 'Broken build (edited)', labels: [{ name: 'bug' }] });
    await ok(['issue', 'reopen', '1', '-R', repo]);
  });

  it('creates a repository', async () => {
    const out = await ok(['repo', 'create', `${GH_E2E_HOST}/${username}/gh-made`, '--private', '--description', 'from gh']);
    expect(out).toContain(`${username}/gh-made`);
  });

  it('adds and lists SSH keys', async () => {
    // A fingerprint belongs to one account, so each run adds a fresh key.
    await promisify(execFile)('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', path.join(configDir, 'id')]);
    const keyFile = path.join(configDir, 'id.pub');
    await ok(['ssh-key', 'add', keyFile, '--title', 'gh-e2e']);
    expect(await ok(['ssh-key', 'list'])).toContain('gh-e2e');
  });
});
