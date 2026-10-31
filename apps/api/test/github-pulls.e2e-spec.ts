import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { type Database, schema } from '@ghost/db';
import type { INestApplication } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import type { Auth } from '../src/lib/auth.js';
import { hasBackends, signUp, startApp } from './harness.js';

/** The pull request routes and fields gh's own suite (gh-cli.e2e-spec.ts) does not reach: REST pulls, reviews, reopening and merge refusals. */
describe.skipIf(!hasBackends)('GitHub pull requests', () => {
  let app: INestApplication;
  let work: string;
  let pushUrl: string;
  let owner: { cookie: string; key: string; userId: string };
  let reviewer: { cookie: string; key: string; userId: string };
  const username = `ghpulls${Date.now()}`;
  const repo = `/repos/${username}/tools`;
  const v3 = () => request(app.getHttpServer());
  const get = (path: string, token = owner.key) =>
    v3().get(`/api/v3${path}`).set('authorization', `token ${token}`);
  const send = (
    method: 'post' | 'patch' | 'put',
    path: string,
    body: object,
    token = owner.key,
  ) =>
    v3()
      [method](`/api/v3${path}`)
      .set('authorization', `token ${token}`)
      .send(body);
  const graphql = async (query: string, token = owner.key) => {
    const { body } = await v3()
      .post('/api/graphql')
      .set('authorization', `token ${token}`)
      .send({ query })
      .expect(200);
    return body;
  };

  beforeAll(async () => {
    let origin: string;
    ({ app, origin } = await startApp());
    owner = await signUp(app, username);
    pushUrl = `${origin.replace('://', `://${username}:${owner.key}@`)}/${username}/tools.git`;
    reviewer = await signUp(app, `${username}r`);
    // GitHub links a commit to an account by verified email only.
    await app
      .get<Database>(DATABASE)
      .update(schema.user)
      .set({ emailVerified: true })
      .where(eq(schema.user.id, owner.userId));
    await v3()
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: 'tools', visibility: 'public' })
      .expect(201);

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-ghpulls-'));
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        [
          '-c',
          'user.name=E2E',
          '-c',
          `user.email=${username}@example.com`,
          ...args,
        ],
        { cwd: work },
      );
    git('init', '-q', '-b', 'main');
    writeFileSync(path.join(work, 'a.txt'), 'one\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    // `feature` merges cleanly, `clash` conflicts with what main gains below, `chore` is closed and reopened.
    for (const [branch, content] of [
      ['feature', 'two\n'],
      ['clash', 'three\n'],
      ['chore', 'four\n'],
    ]) {
      git('checkout', '-q', '-b', branch, 'main');
      writeFileSync(path.join(work, `${branch}.txt`), content!);
      if (branch === 'clash') writeFileSync(path.join(work, 'a.txt'), 'x\n');
      git('add', '.');
      git('commit', '-q', '-m', `Add ${branch}`);
    }
    git('checkout', '-q', 'main');
    writeFileSync(path.join(work, 'a.txt'), 'y\n');
    git('commit', '-q', '-am', 'main moves');
    // The server runs in this process, so the push must not block the event loop.
    await promisify(execFile)(
      'git',
      ['push', '-q', pushUrl, 'main', 'feature', 'clash', 'chore'],
      { cwd: work, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('opens a pull request over REST and answers it in GitHub shape', async () => {
    const { body, headers } = await send('post', `${repo}/pulls`, {
      title: 'Feature',
      head: 'feature',
      base: 'main',
      body: 'Adds a feature',
    }).expect(201);
    expect(headers.location).toBe(body.url);
    expect(body).toMatchObject({
      id: expect.any(Number),
      node_id: expect.stringMatching(/^PR_/),
      number: 1,
      state: 'open',
      title: 'Feature',
      body: 'Adds a feature',
      draft: false,
      merged: false,
      mergeable: true,
      mergeable_state: 'clean',
      commits: 1,
      additions: 1,
      deletions: 0,
      changed_files: 1,
      user: expect.objectContaining({ login: username }),
      head: {
        label: `${username}:feature`,
        ref: 'feature',
        sha: expect.stringMatching(/^[0-9a-f]{40}$/),
        repo: expect.objectContaining({ full_name: `${username}/tools` }),
      },
      base: expect.objectContaining({
        ref: 'main',
        sha: expect.stringMatching(/^[0-9a-f]{40}$/),
      }),
    });
    expect(body.html_url).toMatch(/\/tools\/pull\/1$/);
    // One integer id for the pull request everywhere, as GraphQL's databaseId has always answered.
    const { data } = await graphql(`{
      repository(owner: "${username}", name: "tools") { pullRequest(number: 1) { databaseId } }
    }`);
    expect(data.repository.pullRequest.databaseId).toBe(body.id);
    expect((await get(`${repo}/issues/1`).expect(200)).body.id).toBe(body.id);
  });

  it('answers a conflicting pull request as not mergeable', async () => {
    const { body } = await send('post', `${repo}/pulls`, {
      title: 'Clash',
      head: 'clash',
      base: 'main',
    }).expect(201);
    expect(body).toMatchObject({
      number: 2,
      mergeable: false,
      mergeable_state: 'dirty',
    });
    expect(
      (await send('put', `${repo}/pulls/2/merge`, {}).expect(405)).body,
    ).toMatchObject({ message: 'Pull Request is not mergeable' });
  });

  it('lists by state, head and base, and answers 404 for an issue number', async () => {
    const open = (await get(`${repo}/pulls`).expect(200)).body;
    expect(open.map((pull: { number: number }) => pull.number)).toEqual([2, 1]);
    expect(open[0]).not.toHaveProperty('mergeable');
    expect(
      (await get(`${repo}/pulls?head=${username}:feature`).expect(200)).body,
    ).toEqual([expect.objectContaining({ number: 1 })]);
    expect((await get(`${repo}/pulls?base=nope`).expect(200)).body).toEqual([]);
    expect((await get(`${repo}/pulls?state=closed`).expect(200)).body).toEqual(
      [],
    );
    await v3()
      .post(`/api/repositories/${username}/tools/issues`)
      .set('cookie', owner.cookie)
      .send({ title: 'Not a pull request' })
      .expect(201);
    await get(`${repo}/pulls/3`).expect(404);
  });

  it('answers the diff when Accept asks for it, and the files and commits', async () => {
    const diff = await get(`${repo}/pulls/1`)
      .set('accept', 'application/vnd.github.v3.diff')
      .expect(200);
    expect(diff.text).toContain('diff --git a/feature.txt b/feature.txt');
    const patch = await get(`${repo}/pulls/1`)
      .set('accept', 'application/vnd.github.v3.patch')
      .expect(200);
    expect(patch.text).toMatch(/^From [0-9a-f]{40} /);
    expect(patch.text).toContain('Subject: [PATCH] Add feature');
    expect((await get(`${repo}/pulls/1/files`).expect(200)).body).toEqual([
      expect.objectContaining({
        filename: 'feature.txt',
        status: 'added',
        additions: 1,
        changes: 1,
      }),
    ]);
    expect((await get(`${repo}/pulls/1/commits`).expect(200)).body).toEqual([
      expect.objectContaining({
        sha: expect.stringMatching(/^[0-9a-f]{40}$/),
        commit: expect.objectContaining({
          message: 'Add feature',
          author: expect.objectContaining({
            email: `${username}@example.com`,
            date: expect.any(String),
          }),
        }),
        author: expect.objectContaining({ login: username }),
        committer: expect.objectContaining({ login: username }),
      }),
    ]);
    const { data } = await graphql(`{
      repository(owner: "${username}", name: "tools") {
        pullRequest(number: 1) {
          commits(first: 1) { nodes { commit {
            messageHeadline authoredDate
            authors(first: 1) { nodes { email user { login } } }
          } } }
        }
      }
    }`);
    expect(data.repository.pullRequest.commits.nodes[0].commit).toMatchObject({
      messageHeadline: 'Add feature',
      authoredDate: expect.any(String),
      authors: {
        nodes: [
          { email: `${username}@example.com`, user: { login: username } },
        ],
      },
    });
  });

  it('derives reviewDecision and latestReviews from submitted reviews', async () => {
    await v3()
      .post(`/api/repositories/${username}/tools/pulls/1/reviews`)
      .set('cookie', reviewer.cookie)
      .send({ state: 'commented', body: 'Looking' })
      .expect(201);
    await v3()
      .post(`/api/repositories/${username}/tools/pulls/1/reviews`)
      .set('cookie', reviewer.cookie)
      .send({ state: 'approved' })
      .expect(201);
    const { data } = await graphql(`{
      repository(owner: "${username}", name: "tools") {
        pullRequest(number: 1) {
          state merged isDraft reviewDecision mergeable mergeStateStatus
          reviews(first: 10) { totalCount nodes { databaseId state author { login } commit { oid messageHeadline } } }
          latestReviews(first: 10) { nodes { state } }
        }
      }
    }`);
    expect(data.repository.pullRequest).toMatchObject({
      state: 'OPEN',
      merged: false,
      isDraft: false,
      // GitHub answers null while no rule on the base asks for reviews, approved or not.
      reviewDecision: null,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      reviews: {
        totalCount: 2,
        nodes: [
          { state: 'COMMENTED', author: { login: `${username}r` } },
          {
            state: 'APPROVED',
            commit: {
              oid: expect.stringMatching(/^[0-9a-f]{40}$/),
              messageHeadline: 'Add feature',
            },
          },
        ],
      },
      latestReviews: { nodes: [{ state: 'APPROVED' }] },
    });
    const approved = data.repository.pullRequest.reviews.nodes[1];
    const reviews = (await get(`${repo}/pulls/1/reviews`).expect(200)).body;
    expect(reviews).toEqual([
      expect.objectContaining({
        state: 'COMMENTED',
        body: 'Looking',
        user: expect.objectContaining({ login: `${username}r` }),
      }),
      expect.objectContaining({
        id: approved.databaseId,
        state: 'APPROVED',
        commit_id: approved.commit.oid,
        html_url: expect.stringMatching(/\/pull\/1#pullrequestreview-/),
      }),
    ]);
    expect(
      (await get(`${repo}/pulls/1/reviews/${approved.databaseId}`).expect(200))
        .body,
    ).toEqual(reviews[1]);
    await get(`${repo}/pulls/1/reviews/999999999`).expect(404);
  });

  it('requests, lists and removes reviewers, and refuses an unknown login', async () => {
    const api = `${repo}/pulls/1/requested_reviewers`;
    const reviewerName = `${username}r`;
    await v3()
      .put(`/api/repositories/${username}/tools/collaborators/${reviewerName}`)
      .set('cookie', owner.cookie)
      .send({ role: 'write' })
      .expect(200);
    const invitation = (
      await v3()
        .get('/api/invitations')
        .set('cookie', reviewer.cookie)
        .expect(200)
    ).body.invitations[0];
    await v3()
      .post(`/api/invitations/${invitation.id}/accept`)
      .set('cookie', reviewer.cookie)
      .expect(204);

    // Logins match without regard to case, as on GitHub.
    const requested = await send('post', api, {
      reviewers: [reviewerName.toUpperCase()],
    }).expect(201);
    expect(requested.body).toMatchObject({
      number: 1,
      requested_reviewers: [{ login: reviewerName }],
    });
    expect((await get(api).expect(200)).body).toMatchObject({
      users: [{ login: reviewerName }],
      teams: [],
    });
    expect(
      (await get(`${repo}/pulls/1`).expect(200)).body.requested_reviewers[0]
        .login,
    ).toBe(reviewerName);

    const unknown = await send('post', api, {
      reviewers: ['nobody-here'],
    }).expect(422);
    expect(unknown.body).toMatchObject({
      message: expect.stringContaining('nobody-here'),
      documentation_url: expect.any(String),
      status: '422',
    });

    const removed = await v3()
      .delete(`/api/v3${api}`)
      .set('authorization', `token ${owner.key}`)
      .send({ reviewers: [reviewerName] })
      .expect(200);
    expect(removed.body.requested_reviewers).toEqual([]);
    expect((await get(api).expect(200)).body.users).toEqual([]);
  });

  it('refuses a merge whose head moved on, then merges and reports it', async () => {
    await send('put', `${repo}/pulls/1/merge`, { sha: '0'.repeat(40) }).expect(
      409,
    );
    await get(`${repo}/pulls/1/merge`).expect(404);
    const merged = (
      await send('put', `${repo}/pulls/1/merge`, {
        merge_method: 'squash',
      }).expect(200)
    ).body;
    expect(merged).toMatchObject({ merged: true, sha: expect.any(String) });
    await get(`${repo}/pulls/1/merge`).expect(204);
    expect((await get(`${repo}/pulls/1`).expect(200)).body).toMatchObject({
      state: 'closed',
      merged: true,
      merge_commit_sha: merged.sha,
      merged_by: expect.objectContaining({ login: username }),
    });
    expect((await get(`${repo}/pulls?state=closed`).expect(200)).body).toEqual([
      expect.objectContaining({ number: 1 }),
    ]);
    await send('put', `${repo}/pulls/1/merge`, {}).expect(405);
  });

  it('answers 422 to a review request on a merged pull request', async () => {
    await send('post', `${repo}/pulls/1/requested_reviewers`, {
      reviewers: [`${username}r`],
    }).expect(422);
  });

  it('requests a team of an organization repository by slug', async () => {
    const org = `${username}o`;
    const auth = app.get<AuthService<Auth>>(AuthService).api;
    const headers = new Headers({ cookie: owner.cookie });
    const { id: organizationId } = (await auth.createOrganization({
      body: { name: 'Pulls Org', slug: org },
      headers,
    }))!;
    await v3()
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: 'widget', organization: org, visibility: 'private' })
      .expect(201);
    const core = await auth.createTeam({
      body: { name: 'Core', organizationId },
      headers,
    });
    await v3()
      .put(`/api/repositories/${org}/widget/teams/${core!.id}`)
      .set('cookie', owner.cookie)
      .send({ role: 'read' })
      .expect(204);
    await promisify(execFile)(
      'git',
      [
        'push',
        '-q',
        pushUrl.replace(`/${username}/tools.git`, `/${org}/widget.git`),
        'main',
        'feature',
      ],
      { cwd: work, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
    const orgRepo = `/repos/${org}/widget`;
    await send('post', `${orgRepo}/pulls`, {
      title: 'Feature',
      head: 'feature',
      base: 'main',
    }).expect(201);

    const { body } = await send(
      'post',
      `${orgRepo}/pulls/1/requested_reviewers`,
      { team_reviewers: ['Core'] },
    ).expect(201);
    expect(body.requested_teams).toEqual([
      expect.objectContaining({
        slug: 'core',
        name: 'Core',
        node_id: expect.stringMatching(/^T_/),
      }),
    ]);
  }, 60_000);

  it('closes and reopens over REST, and never reopens a merged one', async () => {
    await send('post', `${repo}/pulls`, {
      title: 'Chore',
      head: 'chore',
      base: 'main',
    }).expect(201);
    expect(
      (await send('patch', `${repo}/pulls/4`, { state: 'closed' }).expect(200))
        .body,
    ).toMatchObject({ state: 'closed', merged: false });
    expect(
      (await send('patch', `${repo}/pulls/4`, { state: 'open' }).expect(200))
        .body,
    ).toMatchObject({ state: 'open' });
    await send('patch', `${repo}/pulls/4`, { base: 'feature' }).expect(422);
    await send('patch', `${repo}/pulls/1`, { state: 'open' }).expect(422);
    const update = await graphql(`mutation {
      updatePullRequest(input: { pullRequestId: "${(await get(`${repo}/pulls/1`)).body.node_id}", state: OPEN }) {
        pullRequest { state }
      }
    }`);
    expect(update.errors[0]).toMatchObject({ type: 'UNPROCESSABLE' });
    const { errors } = await graphql(`mutation {
      reopenPullRequest(input: { pullRequestId: "${(await get(`${repo}/pulls/1`)).body.node_id}" }) {
        pullRequest { state }
      }
    }`);
    expect(errors[0]).toMatchObject({ type: 'UNPROCESSABLE' });
  });

  it('answers the merge and closing fields gh pr view --json asks for', async () => {
    await send('patch', `${repo}/pulls/1`, { body: 'Fixes #3' }).expect(200);
    const rest = (await get(`${repo}/pulls/1`).expect(200)).body;
    const tip = execFileSync('git', ['rev-parse', 'main'], { cwd: work })
      .toString()
      .trim();
    const { data } = await graphql(`{
      repository(owner: "${username}", name: "tools") {
        merged: pullRequest(number: 1) {
          mergeCommit { oid } mergedBy { login } baseRefOid fullDatabaseId databaseId
          closingIssuesReferences(first: 100) { nodes { number repository { name owner { login } } } pageInfo { hasNextPage } }
        }
        conflicting: pullRequest(number: 2) { potentialMergeCommit { oid } mergeCommit { oid } mergedBy { login } }
      }
    }`);
    expect(data.repository.merged).toEqual({
      mergeCommit: { oid: rest.merge_commit_sha },
      mergedBy: { login: username },
      baseRefOid: tip,
      fullDatabaseId: String(rest.id),
      databaseId: rest.id,
      closingIssuesReferences: {
        nodes: [
          {
            number: 3,
            repository: { name: 'tools', owner: { login: username } },
          },
        ],
        pageInfo: { hasNextPage: false },
      },
    });
    expect(data.repository.conflicting).toEqual({
      potentialMergeCommit: null,
      mergeCommit: null,
      mergedBy: null,
    });
    // Closed with its head branch gone, the request still names the base branch's tip.
    await send('patch', `${repo}/pulls/2`, { state: 'closed' }).expect(200);
    await v3()
      .delete(`/api/v3${repo}/git/refs/heads/clash`)
      .set('authorization', `token ${owner.key}`)
      .expect(204);
    const closed = await graphql(`{
      repository(owner: "${username}", name: "tools") { pullRequest(number: 2) { baseRefOid } }
    }`);
    expect(closed.data.repository.pullRequest).toEqual({
      baseRefOid: rest.merge_commit_sha,
    });
    await vi.waitFor(async () => {
      const { data } = await graphql(`{
        repository(owner: "${username}", name: "tools") {
          pullRequest(number: 4) { headRefOid potentialMergeCommit { oid } }
        }
      }`);
      expect(data.repository.pullRequest.potentialMergeCommit).toEqual({
        oid: expect.stringMatching(/^[0-9a-f]{40}$/),
      });
      expect(data.repository.pullRequest.potentialMergeCommit.oid).not.toBe(
        data.repository.pullRequest.headRefOid,
      );
    });
  });

  it("resolves a pull request's comment by node id", async () => {
    const comment = (
      await send('post', `${repo}/issues/4/comments`, {
        body: 'On a PR',
      }).expect(201)
    ).body;
    const { data } = await graphql(
      `{ node(id: "${comment.node_id}") { ... on IssueComment { body } } }`,
    );
    expect(data.node).toEqual({ body: 'On a PR' });
  });

  it('refuses a pull request id where an issue is asked for, and the reverse', async () => {
    const pull = (await get(`${repo}/pulls/4`)).body.node_id;
    const issue = (await get(`${repo}/issues/3`)).body.node_id;
    const closeIssue = await graphql(`mutation {
      closeIssue(input: { issueId: "${pull}" }) { issue { id } }
    }`);
    expect(closeIssue.errors[0]).toMatchObject({ type: 'NOT_FOUND' });
    const closePull = await graphql(`mutation {
      closePullRequest(input: { pullRequestId: "${issue}" }) { pullRequest { id } }
    }`);
    expect(closePull.errors[0]).toMatchObject({ type: 'NOT_FOUND' });
  });

  it('lists the oldest commits first when a pull request has more than one page of them', async () => {
    // One past the 250 Ghost reads at once, so the oldest would be cut if the newest were read first.
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
        {
          cwd: work,
        },
      );
    git('checkout', '-q', '-b', 'long', 'main');
    for (let n = 1; n <= 251; n++)
      git('commit', '-q', '--allow-empty', '-m', `long ${n}`);
    await promisify(execFile)('git', ['push', '-q', pushUrl, 'long'], {
      cwd: work,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    const { number } = (
      await send('post', `${repo}/pulls`, {
        title: 'Long',
        head: 'long',
        base: 'main',
      }).expect(201)
    ).body;
    const commits = (
      await get(`${repo}/pulls/${number}/commits?per_page=1`).expect(200)
    ).body;
    expect(commits[0].commit.message).toBe('long 1');
    const { data } = await graphql(`{
      repository(owner: "${username}", name: "tools") {
        pullRequest(number: ${number}) { commits(first: 1) { totalCount nodes { commit { messageHeadline } } } }
      }
    }`);
    expect(data.repository.pullRequest.commits).toEqual({
      totalCount: 251,
      nodes: [{ commit: { messageHeadline: 'long 1' } }],
    });
  }, 60_000);
});
