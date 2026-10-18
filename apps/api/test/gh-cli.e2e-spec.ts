import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { type Database, schema } from '@ghost/db';
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import { GH_E2E_HOST, runGh, startGh, tlsFiles } from './gh.js';
import { recordGhRequests, writeGhCapture } from './gh-capture.js';
import { apiKey, hasBackends, scopedKey, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends || !GH_E2E_HOST)('gh CLI', () => {
  let app: INestApplication;
  let owner: { cookie: string; key: string; userId: string };
  let reviewer: { cookie: string; key: string; userId: string };
  let configDir: string;
  const username = `ghcli${Date.now()}`;
  const reviewerName = `${username}r`;
  let api: ReturnType<(typeof request)['agent']>;
  let token: string;

  const gh = (args: string[], options: { input?: string; cwd?: string } = {}) =>
    runGh(args, { configDir, token, ...options });
  const ok = async (
    args: string[],
    options: { input?: string; cwd?: string } = {},
  ) => {
    const result = await gh(args, options);
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
      (app) => app.use(recordGhRequests),
    ));
    owner = await signUp(app, username);
    configDir = mkdtempSync(path.join(tmpdir(), 'gh-e2e-'));
    // The app serves the self-signed e2e certificate, which supertest must be told to trust.
    api = request.agent(app.getHttpServer()).ca(cert);
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
    // Two branches for the gh pr cases: one to merge, one to close and reopen.
    for (const [branch, file] of [
      ['feature', 'feature.txt'],
      ['chore', 'chore.txt'],
    ]) {
      await git('checkout', '-q', '-b', branch, 'main');
      writeFileSync(path.join(work, file), `${branch}\n`);
      await git('add', '.');
      await git(
        '-c',
        'user.name=E2E',
        '-c',
        'user.email=e2e@example.com',
        'commit',
        '-qm',
        `Add ${file}`,
      );
      await git(
        'push',
        '-q',
        `https://${username}:${owner.key}@${GH_E2E_HOST}/${username}/tools.git`,
        branch,
      );
    }
    for (const title of ['Broken build', 'Docs typo']) {
      await api
        .post(`/api/repositories/${username}/tools/issues`)
        .set('cookie', owner.cookie)
        .send({ title })
        .expect(201);
    }
    await api
      .post(`/api/repositories/${username}/tools/issues/1/comments`)
      .set('cookie', owner.cookie)
      .send({ body: 'Seen it too' })
      .expect(201);
    await api
      .post(`/api/repositories/${username}/tools/labels`)
      .set('cookie', owner.cookie)
      .send({ name: 'bug', color: 'd73a4a' })
      .expect(201);
    // A collaborator to request reviews from: only users with a role on the repository can be asked.
    reviewer = await signUp(app, reviewerName);
    // gh 2.102 edits reviewers on an enterprise host by sending back each pending reviewer's display name, `login (Name)`, as a login; only a reviewer without a name survives that.
    await app
      .get<Database>(DATABASE)
      .update(schema.user)
      .set({ name: '' })
      .where(eq(schema.user.id, reviewer.userId));
    await api
      .put(`/api/repositories/${username}/tools/collaborators/${reviewerName}`)
      .set('cookie', owner.cookie)
      .send({ role: 'write' })
      .expect(200);
    const invitation = (
      await api
        .get('/api/invitations')
        .set('cookie', reviewer.cookie)
        .expect(200)
    ).body.invitations[0];
    await api
      .post(`/api/invitations/${invitation.id}/accept`)
      .set('cookie', reviewer.cookie)
      .expect(204);
  });

  // A key allows 120 requests a minute, which the whole suite on one key would pass.
  beforeEach(async () => {
    token = await apiKey(app, owner.userId);
  });

  afterAll(async () => {
    writeGhCapture({ login: username, host: GH_E2E_HOST! });
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
    const out = await ok([
      'issue',
      'list',
      '-R',
      `${GH_E2E_HOST}/${username}/tools`,
      '--json',
      'number,title,state,labels,author,url',
    ]);
    const issues = JSON.parse(out);
    expect(issues.map((issue: { title: string }) => issue.title)).toEqual(
      expect.arrayContaining(['Broken build', 'Docs typo']),
    );
    expect(issues[0].state).toBe('OPEN');
  });

  it('views an issue with comments', async () => {
    const repo = `${GH_E2E_HOST}/${username}/tools`;
    expect(await ok(['issue', 'view', '1', '-R', repo])).toContain(
      'Broken build',
    );
    // Without a terminal, --comments prints only the comments.
    expect(
      await ok(['issue', 'view', '1', '-R', repo, '--comments']),
    ).toContain('Seen it too');
  });

  it('filters issues by state, label, author and assignee', async () => {
    const out = await ok([
      'issue',
      'list',
      '-R',
      `${GH_E2E_HOST}/${username}/tools`,
      '--state',
      'all',
      '--author',
      username,
      '--json',
      'number',
    ]);
    expect(JSON.parse(out).length).toBeGreaterThanOrEqual(2);
  });

  it('searches issues', async () => {
    const out = await ok([
      'issue',
      'list',
      '-R',
      `${GH_E2E_HOST}/${username}/tools`,
      '--search',
      'build',
      '--json',
      'title',
    ]);
    expect(JSON.parse(out)).toEqual([{ title: 'Broken build' }]);
  });

  it('creates an issue with a label and an assignee', async () => {
    const out = await ok([
      'issue',
      'create',
      '-R',
      `${GH_E2E_HOST}/${username}/tools`,
      '--title',
      'Made by gh',
      '--body',
      'Body',
      '--label',
      'bug',
      '--assignee',
      username,
    ]);
    expect(out).toMatch(new RegExp(`/${username}/tools/issues/\\d+`));
  });

  it('comments on, edits, closes and reopens an issue', async () => {
    const repo = `${GH_E2E_HOST}/${username}/tools`;
    await ok(['issue', 'comment', '1', '-R', repo, '--body', 'From gh']);
    await ok([
      'issue',
      'edit',
      '1',
      '-R',
      repo,
      '--title',
      'Broken build (edited)',
      '--add-label',
      'bug',
    ]);
    await ok(['issue', 'close', '1', '-R', repo]);
    expect(
      JSON.parse(
        await ok([
          'issue',
          'view',
          '1',
          '-R',
          repo,
          '--json',
          'state,title,labels',
        ]),
      ),
    ).toMatchObject({
      state: 'CLOSED',
      title: 'Broken build (edited)',
      labels: [{ name: 'bug' }],
    });
    await ok(['issue', 'reopen', '1', '-R', repo]);
  });

  it('creates, edits, lists, clones and deletes labels', async () => {
    const repo = `${GH_E2E_HOST}/${username}/tools`;
    await ok([
      'label',
      'create',
      'gh-made',
      '-R',
      repo,
      '--color',
      'D93F0B',
      '--description',
      'From gh',
    ]);
    await ok([
      'label',
      'edit',
      'gh-made',
      '-R',
      repo,
      '--name',
      'gh-edited',
      '--color',
      '0E8A16',
    ]);
    const labels = JSON.parse(
      await ok([
        'label',
        'list',
        '-R',
        repo,
        '--json',
        'name,color,description',
      ]),
    );
    expect(labels).toContainEqual({
      name: 'gh-edited',
      color: '0e8a16',
      description: 'From gh',
    });

    await api
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: 'label-target', visibility: 'public' })
      .expect(201);
    const target = `${GH_E2E_HOST}/${username}/label-target`;
    await ok(['label', 'clone', repo, '-R', target]);
    const cloned = JSON.parse(
      await ok(['label', 'list', '-R', target, '--json', 'name']),
    );
    expect(cloned).toContainEqual({ name: 'gh-edited' });

    await ok(['label', 'delete', 'gh-edited', '-R', repo, '--yes']);
    const after = JSON.parse(
      await ok(['label', 'list', '-R', repo, '--json', 'name']),
    );
    expect(after).not.toContainEqual({ name: 'gh-edited' });
  });

  it('pages REST issue lists with gh api --paginate and edits a comment by id', async () => {
    const repo = `repos/${username}/tools`;
    const all = JSON.parse(
      await ok([
        'api',
        `${repo}/issues?state=all&per_page=1`,
        '--paginate',
        '--slurp',
      ]),
    );
    const single = JSON.parse(
      await ok(['api', `${repo}/issues?state=all&per_page=100`]),
    );
    expect(all.flat()).toHaveLength(single.length);

    const comment = JSON.parse(
      await ok(['api', `${repo}/issues/1/comments`, '-f', 'body=Via REST']),
    );
    const edited = JSON.parse(
      await ok([
        'api',
        '-X',
        'PATCH',
        `${repo}/issues/comments/${comment.id}`,
        '-f',
        'body=Edited via REST',
      ]),
    );
    expect(edited).toMatchObject({ id: comment.id, body: 'Edited via REST' });
  });

  describe('gh pr', () => {
    const repo = () => `${GH_E2E_HOST}/${username}/tools`;
    let number: string;
    const view = async (fields: string) =>
      JSON.parse(
        await ok(['pr', 'view', number, '-R', repo(), '--json', fields]),
      );

    it('creates a pull request', async () => {
      const out = await ok([
        'pr',
        'create',
        '-R',
        repo(),
        '--head',
        'feature',
        '--base',
        'main',
        '--title',
        'Add a feature',
        '--body',
        'Body from gh',
        '--reviewer',
        reviewerName,
      ]);
      const match = out.match(new RegExp(`/${username}/tools/pull/(\\d+)`));
      expect(match, out).not.toBeNull();
      number = match![1];
      expect(await view('reviewRequests')).toEqual({
        reviewRequests: [
          expect.objectContaining({ __typename: 'User', login: reviewerName }),
        ],
      });
    });

    it('lists pull requests', async () => {
      const list = JSON.parse(
        await ok([
          'pr',
          'list',
          '-R',
          repo(),
          '--json',
          'number,title,state,headRefName,baseRefName,isDraft,author',
        ]),
      );
      expect(list).toContainEqual(
        expect.objectContaining({
          number: Number(number),
          title: 'Add a feature',
          state: 'OPEN',
          headRefName: 'feature',
          baseRefName: 'main',
          isDraft: false,
          author: expect.objectContaining({ login: username }),
        }),
      );
    });

    it('views a pull request', async () => {
      expect(
        await view(
          'number,title,body,state,headRefName,baseRefName,additions,deletions,changedFiles,files,commits,reviewDecision,mergeable,url',
        ),
      ).toMatchObject({
        number: Number(number),
        title: 'Add a feature',
        body: 'Body from gh',
        state: 'OPEN',
        headRefName: 'feature',
        baseRefName: 'main',
        additions: 1,
        deletions: 0,
        changedFiles: 1,
        files: [expect.objectContaining({ path: 'feature.txt' })],
        commits: [
          expect.objectContaining({ messageHeadline: 'Add feature.txt' }),
        ],
        url: expect.stringMatching(
          new RegExp(`/${username}/tools/pull/${number}$`),
        ),
      });
    });

    it('lists pull request checks', async () => {
      const { headRefOid } = await view('headRefOid');
      await ok([
        'api',
        '-X',
        'POST',
        `repos/${username}/tools/statuses/${headRefOid}`,
        '-f',
        'state=success',
        '-f',
        'context=ci/test',
        '-f',
        'description=ok',
        '-f',
        'target_url=https://ci.example/1',
      ]);
      expect(
        JSON.parse(
          await ok([
            'pr',
            'checks',
            number,
            '-R',
            repo(),
            '--json',
            'name,state,bucket,link',
          ]),
        ),
      ).toEqual([
        {
          name: 'ci/test',
          state: 'SUCCESS',
          bucket: 'pass',
          link: 'https://ci.example/1',
        },
      ]);
    });

    it('comments on a pull request and views it with comments', async () => {
      await ok(['pr', 'comment', number, '-R', repo(), '--body', 'Looks good']);
      expect(
        await ok(['pr', 'view', number, '-R', repo(), '--comments']),
      ).toContain('Looks good');
    });

    it('shows pull request status', async () => {
      expect(await ok(['pr', 'status', '-R', repo()])).toContain(
        'Add a feature',
      );
      const asReviewer = await runGh(['pr', 'status', '-R', repo()], {
        configDir,
        token: await apiKey(app, reviewer.userId),
      });
      expect(asReviewer, asReviewer.stderr).toMatchObject({ code: 0 });
      expect(asReviewer.stdout).toMatch(
        /Requesting a code review from you\s+#\d+\s+Add a feature/,
      );
    });

    it('shows a pull request diff', async () => {
      expect(await ok(['pr', 'diff', number, '-R', repo()])).toContain(
        'diff --git a/feature.txt b/feature.txt',
      );
    });

    it('edits a pull request', async () => {
      await ok([
        'pr',
        'edit',
        number,
        '-R',
        repo(),
        '--title',
        'Add a feature (edited)',
        '--add-label',
        'bug',
      ]);
      expect(await view('title,labels')).toMatchObject({
        title: 'Add a feature (edited)',
        labels: [expect.objectContaining({ name: 'bug' })],
      });
    });

    it('removes and adds a reviewer', async () => {
      await ok(['pr', 'edit', number, '-R', repo(), '--remove-reviewer', reviewerName]);
      expect(await view('reviewRequests')).toEqual({ reviewRequests: [] });
      await ok(['pr', 'edit', number, '-R', repo(), '--add-reviewer', reviewerName]);
      expect(await view('reviewRequests')).toEqual({
        reviewRequests: [expect.objectContaining({ login: reviewerName })],
      });
    });

    it('converts a pull request to a draft and back', async () => {
      await ok(['pr', 'ready', number, '-R', repo(), '--undo']);
      expect(await view('isDraft')).toEqual({ isDraft: true });
      await ok(['pr', 'ready', number, '-R', repo()]);
      expect(await view('isDraft')).toEqual({ isDraft: false });
    });

    it('checks out a pull request', async () => {
      const target = path.join(configDir, 'pr-checkout');
      await ok(['repo', 'clone', repo(), target]);
      await ok(['pr', 'checkout', number], { cwd: target });
      const { stdout } = await promisify(execFile)(
        'git',
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        { cwd: target },
      );
      expect(stdout.trim()).toBe('feature');
      expect(readFileSync(path.join(target, 'feature.txt'), 'utf8')).toBe(
        'feature\n',
      );
    });

    it('closes and reopens a pull request', async () => {
      const out = await ok([
        'pr',
        'create',
        '-R',
        repo(),
        '--head',
        'chore',
        '--base',
        'main',
        '--title',
        'A chore',
        '--body',
        '',
      ]);
      const chore = out.match(/\/pull\/(\d+)/)![1];
      await ok(['pr', 'close', chore, '-R', repo()]);
      expect(
        JSON.parse(
          await ok(['pr', 'view', chore, '-R', repo(), '--json', 'state']),
        ),
      ).toEqual({ state: 'CLOSED' });
      await ok(['pr', 'reopen', chore, '-R', repo()]);
      expect(
        JSON.parse(
          await ok(['pr', 'view', chore, '-R', repo(), '--json', 'state']),
        ),
      ).toEqual({ state: 'OPEN' });
    });

    it('merges a pull request', async () => {
      await ok(['pr', 'merge', number, '-R', repo(), '--squash']);
      expect(
        await view(
          'state,mergedAt,mergeCommit,mergedBy,baseRefOid,potentialMergeCommit,fullDatabaseId,closingIssuesReferences',
        ),
      ).toMatchObject({
        state: 'MERGED',
        mergedAt: expect.any(String),
        mergeCommit: { oid: expect.stringMatching(/^[0-9a-f]{40}$/) },
        mergedBy: expect.objectContaining({ login: username }),
        baseRefOid: expect.stringMatching(/^[0-9a-f]{40}$/),
        fullDatabaseId: expect.stringMatching(/^\d+$/),
        closingIssuesReferences: [],
      });
    });
  });

  describe('gh release', () => {
    const repo = () => `${GH_E2E_HOST}/${username}/tools`;
    const view = async (tag: string, fields: string) =>
      JSON.parse(
        await ok(['release', 'view', tag, '-R', repo(), '--json', fields]),
      );
    const asset = (name: string) => {
      const file = path.join(configDir, name);
      writeFileSync(file, `${name}\n`);
      return file;
    };

    it('creates a release with an asset', async () => {
      const out = await ok([
        'release',
        'create',
        'v1.0',
        asset('notes.txt'),
        '-R',
        repo(),
        '--target',
        'main',
        '--title',
        'First release',
        '--notes',
        'Notes from gh',
      ]);
      expect(out).toContain(`/${username}/tools/releases/tag/v1.0`);
    });

    it('lists releases', async () => {
      expect(
        JSON.parse(
          await ok([
            'release',
            'list',
            '-R',
            repo(),
            '--json',
            'tagName,name,isDraft,isPrerelease,isLatest,publishedAt',
          ]),
        ),
      ).toContainEqual(
        expect.objectContaining({
          tagName: 'v1.0',
          name: 'First release',
          isDraft: false,
          isPrerelease: false,
          isLatest: true,
        }),
      );
    });

    it('views a release', async () => {
      expect(
        await view(
          'v1.0',
          'tagName,name,body,isDraft,isPrerelease,author,assets,targetCommitish,url',
        ),
      ).toMatchObject({
        tagName: 'v1.0',
        name: 'First release',
        body: 'Notes from gh',
        isDraft: false,
        isPrerelease: false,
        author: expect.objectContaining({ login: username }),
        assets: [expect.objectContaining({ name: 'notes.txt' })],
        url: expect.stringMatching(
          new RegExp(`/${username}/tools/releases/tag/v1.0$`),
        ),
      });
    });

    it('views the latest release', async () => {
      expect(
        JSON.parse(
          await ok(['release', 'view', '-R', repo(), '--json', 'tagName']),
        ),
      ).toEqual({ tagName: 'v1.0' });
    });

    it('creates a draft release', async () => {
      await ok([
        'release',
        'create',
        'v2.0',
        '-R',
        repo(),
        '--target',
        'main',
        '--draft',
        '--notes',
        'Not yet',
      ]);
      expect(await view('v2.0', 'isDraft')).toEqual({ isDraft: true });
    });

    it('uploads an asset', async () => {
      await ok(['release', 'upload', 'v1.0', asset('extra.txt'), '-R', repo()]);
      expect(await view('v1.0', 'assets')).toMatchObject({
        assets: expect.arrayContaining([
          expect.objectContaining({ name: 'extra.txt' }),
        ]),
      });
    });

    it('downloads an asset', async () => {
      const dir = path.join(configDir, 'release-download');
      await ok([
        'release',
        'download',
        'v1.0',
        '-R',
        repo(),
        '--pattern',
        'notes.txt',
        '--dir',
        dir,
      ]);
      expect(readFileSync(path.join(dir, 'notes.txt'), 'utf8')).toBe(
        'notes.txt\n',
      );
    });

    it('deletes an asset', async () => {
      await ok([
        'release',
        'delete-asset',
        'v1.0',
        'extra.txt',
        '-R',
        repo(),
        '--yes',
      ]);
      expect(await view('v1.0', 'assets')).toMatchObject({
        assets: [expect.objectContaining({ name: 'notes.txt' })],
      });
    });

    it('edits a release', async () => {
      await ok([
        'release',
        'edit',
        'v1.0',
        '-R',
        repo(),
        '--title',
        'First release (edited)',
        '--notes',
        'Edited notes',
        '--prerelease',
      ]);
      expect(await view('v1.0', 'name,body,isPrerelease')).toEqual({
        name: 'First release (edited)',
        body: 'Edited notes',
        isPrerelease: true,
      });
    });

    it('deletes a release and its tag', async () => {
      await ok([
        'release',
        'delete',
        'v1.0',
        '-R',
        repo(),
        '--yes',
        '--cleanup-tag',
      ]);
      expect(
        (await gh(['release', 'view', 'v1.0', '-R', repo()])).code,
      ).not.toBe(0);
    });
  });

  it('creates a repository', async () => {
    const out = await ok([
      'repo',
      'create',
      `${GH_E2E_HOST}/${username}/gh-made`,
      '--private',
      '--description',
      'from gh',
    ]);
    expect(out).toContain(`${username}/gh-made`);
  });

  it('creates a repository from a README, .gitignore and license template', async () => {
    const repo = `${GH_E2E_HOST}/${username}/gh-templated`;
    await ok([
      'repo',
      'create',
      repo,
      '--public',
      '--add-readme',
      '--gitignore',
      'Go',
      '--license',
      'mit',
    ]);
    const target = path.join(configDir, 'gh-templated');
    await ok(['repo', 'clone', repo, target]);
    expect(readFileSync(path.join(target, 'README.md'), 'utf8')).toBe(
      '# gh-templated\n',
    );
    expect(readFileSync(path.join(target, '.gitignore'), 'utf8')).toContain(
      '*.exe',
    );
    expect(readFileSync(path.join(target, 'LICENSE'), 'utf8')).toContain(
      'MIT License',
    );
  });

  it('adds and lists SSH keys', async () => {
    // A fingerprint belongs to one account, so each run adds a fresh key.
    await promisify(execFile)('ssh-keygen', [
      '-q',
      '-t',
      'ed25519',
      '-N',
      '',
      '-f',
      path.join(configDir, 'id'),
    ]);
    const keyFile = path.join(configDir, 'id.pub');
    await ok(['ssh-key', 'add', keyFile, '--title', 'gh-e2e']);
    expect(await ok(['ssh-key', 'list'])).toContain('gh-e2e');
  });
  it('logs in through the device flow', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gh-e2e-web-'));
    const login = startGh(
      [
        'auth',
        'login',
        '--hostname',
        GH_E2E_HOST!,
        '--web',
        '--git-protocol',
        'https',
        '--skip-ssh-key',
      ],
      { configDir: dir },
    );
    const [, userCode] = await login.stderrUntil(/one-time code: (\S+)/);
    await api
      .get('/api/auth/device')
      .query({ user_code: userCode.replace('-', '') })
      .set('cookie', owner.cookie)
      .expect(200);
    await api
      .post('/api/auth/device/approve')
      .set('cookie', owner.cookie)
      .send({ userCode: userCode.replace('-', '') })
      .expect(200);
    const result = await login.done;
    expect(result, result.stderr).toMatchObject({ code: 0 });
    // gh auth status lists scopes only for ghp_ and gho_ tokens, so read the header gh got them from.
    const root = await runGh(['api', '--include', '/'], { configDir: dir });
    expect(root.stdout, root.stderr).toMatch(
      /^X-Oauth-Scopes: repo, read:org, gist\r?$/im,
    );
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it('widens scopes with gh auth refresh', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gh-e2e-refresh-'));
    await runGh(['auth', 'login', '--hostname', GH_E2E_HOST!, '--with-token'], {
      configDir: dir,
      input: await scopedKey(app, owner.userId, ['repo', 'read:org', 'gist']),
    });
    const refresh = startGh(
      [
        'auth',
        'refresh',
        '--hostname',
        GH_E2E_HOST!,
        '--scopes',
        'admin:public_key',
      ],
      { configDir: dir },
    );
    const [, userCode] = await refresh.stderrUntil(/one-time code: (\S+)/);
    await api
      .get('/api/auth/device')
      .query({ user_code: userCode.replace('-', '') })
      .set('cookie', owner.cookie)
      .expect(200);
    await api
      .post('/api/auth/device/approve')
      .set('cookie', owner.cookie)
      .send({ userCode: userCode.replace('-', '') })
      .expect(200);
    expect((await refresh.done).code).toBe(0);
    const root = await runGh(['api', '--include', '/'], { configDir: dir });
    expect(root.stdout, root.stderr).toMatch(
      /^X-Oauth-Scopes: .*\badmin:public_key\b/im,
    );
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);
});
