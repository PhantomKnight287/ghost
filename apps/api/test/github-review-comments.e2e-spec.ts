import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, scopedKey, signUp, startApp } from './harness.js';

/** GitHub's REST review comments and review submission, as a bot mirroring reviews between GitHub and Ghost uses them. */
describe.skipIf(!hasBackends)('GitHub review comments', () => {
  let app: INestApplication;
  let work: string;
  let root: string;
  let older: string;
  let head: string;
  let stray: string;
  let owner: { cookie: string; key: string; userId: string };
  let reviewer: { cookie: string; key: string; userId: string };
  const username = `ghreview${Date.now()}`;
  const repo = `/repos/${username}/tools`;
  const v3 = () => request(app.getHttpServer());
  const get = (path: string, token = reviewer.key) =>
    v3().get(`/api/v3${path}`).set('authorization', `token ${token}`);
  const graphql = async (query: string) => {
    const { body } = await v3()
      .post('/api/graphql')
      .set('authorization', `token ${reviewer.key}`)
      .send({ query })
      .expect(200);
    return body.data;
  };
  const send = (
    method: 'post' | 'patch' | 'delete',
    path: string,
    body: object,
    token = reviewer.key,
  ) =>
    v3()
      [method](`/api/v3${path}`)
      .set('authorization', `token ${token}`)
      .send(body);

  beforeAll(async () => {
    let origin: string;
    ({ app, origin } = await startApp());
    owner = await signUp(app, username);
    reviewer = await signUp(app, `${username}r`);
    await v3()
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: 'tools', visibility: 'public' })
      .expect(201);

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-ghreview-'));
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
        { cwd: work },
      )
        .toString()
        .trim();
    git('init', '-q', '-b', 'main');
    writeFileSync(path.join(work, 'a.txt'), 'one\ntwo\nthree\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    root = git('rev-parse', 'HEAD');
    // `other` stands in for a commit a force-push dropped: it never reaches the head.
    git('checkout', '-q', '-b', 'other');
    git('commit', '-q', '--allow-empty', '-m', 'Elsewhere');
    stray = git('rev-parse', 'HEAD');
    git('checkout', '-q', '-b', 'feature', 'main');
    writeFileSync(path.join(work, 'a.txt'), 'one\nTWO\nthree\n');
    git('commit', '-q', '-am', 'Shout two');
    older = git('rev-parse', 'HEAD');
    writeFileSync(path.join(work, 'b.txt'), 'new\n');
    git('add', '.');
    git('commit', '-q', '-m', 'Add b');
    head = git('rev-parse', 'HEAD');
    // The server runs in this process, so the push must not block the event loop.
    await promisify(execFile)(
      'git',
      [
        'push',
        '-q',
        `${origin.replace('://', `://${username}:${owner.key}@`)}/${username}/tools.git`,
        'main',
        'feature',
        'other',
      ],
      { cwd: work, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
    await send(
      'post',
      `${repo}/pulls`,
      { title: 'Shout', head: 'feature', base: 'main' },
      owner.key,
    ).expect(201);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  let first: { id: number; pull_request_review_id: number };

  it('comments on a line in a review of its own, in GitHub shape', async () => {
    const { body } = await send('post', `${repo}/pulls/1/comments`, {
      body: 'Why shout?',
      commit_id: head,
      path: 'a.txt',
      line: 2,
    }).expect(201);
    expect(body).toMatchObject({
      id: expect.any(Number),
      node_id: expect.stringMatching(/^PRRC_/),
      pull_request_review_id: expect.any(Number),
      path: 'a.txt',
      line: 2,
      original_line: 2,
      side: 'RIGHT',
      start_line: null,
      start_side: null,
      commit_id: head,
      original_commit_id: head,
      diff_hunk: expect.stringContaining('+TWO'),
      body: 'Why shout?',
      user: expect.objectContaining({ login: `${username}r` }),
      author_association: 'NONE',
      subject_type: 'line',
      pull_request_url: expect.stringMatching(/\/pulls\/1$/),
      html_url: expect.stringMatching(/\/pull\/1#discussion_r/),
    });
    expect(body).not.toHaveProperty('in_reply_to_id');
    expect(body.url).toMatch(new RegExp(`/pulls/comments/${body.id}$`));
    first = body;
    expect(
      (await get(`${repo}/pulls/1/reviews/${body.pull_request_review_id}`))
        .body,
    ).toMatchObject({ state: 'COMMENTED', body: '' });
  });

  it("places a comment on an earlier commit by that commit's diff", async () => {
    const { body } = await send('post', `${repo}/pulls/1/comments`, {
      body: 'Earlier',
      commit_id: older,
      path: 'a.txt',
      line: 2,
    }).expect(201);
    expect(body).toMatchObject({ commit_id: older, line: 2 });
    await send('delete', `${repo}/pulls/comments/${body.id}`, {}).expect(204);
    await send('post', `${repo}/pulls/1/comments`, {
      body: 'Not yet there',
      commit_id: older,
      path: 'b.txt',
      line: 1,
    }).expect(422);
  });

  it('refuses a comment the diff cannot place', async () => {
    for (const commit of [stray, root, '0'.repeat(40)]) {
      const { body } = await send('post', `${repo}/pulls/1/comments`, {
        body: 'Elsewhere',
        commit_id: commit,
        path: 'a.txt',
        line: 2,
      }).expect(422);
      expect(body.message).toBe(
        `${commit} is not a commit of this pull request`,
      );
    }
    await send('post', `${repo}/pulls/1/comments`, {
      body: 'Nowhere',
      commit_id: head,
      path: 'a.txt',
      line: 40,
    }).expect(422);
    const { body } = await send('post', `${repo}/pulls/1/comments`, {
      body: 'No line',
      commit_id: head,
      path: 'a.txt',
    }).expect(422);
    expect(body).toMatchObject({
      message: 'Validation Failed',
      errors: expect.arrayContaining([
        expect.objectContaining({ field: 'line' }),
      ]),
    });
  });

  let agreed: { id: number; pull_request_review_id: number };

  it('replies in the thread in a review of its own, which the conversation leaves out', async () => {
    const { body } = await send('post', `${repo}/pulls/1/comments`, {
      body: 'Agreed',
      in_reply_to: first.id,
    }).expect(201);
    expect(body).toMatchObject({
      in_reply_to_id: first.id,
      pull_request_review_id: expect.any(Number),
      path: 'a.txt',
      line: 2,
      diff_hunk: expect.stringContaining('+TWO'),
      body: 'Agreed',
    });
    expect(body.pull_request_review_id).not.toBe(first.pull_request_review_id);
    agreed = body;
    expect(
      (
        await get(
          `${repo}/pulls/1/reviews/${body.pull_request_review_id}/comments`,
        ).expect(200)
      ).body,
    ).toEqual([expect.objectContaining({ id: body.id })]);
    const { timeline } = (
      await v3()
        .get(`/api/repositories/${username}/tools/issues/1/timeline`)
        .expect(200)
    ).body;
    const reviews = timeline.filter(
      (item: { kind: string }) => item.kind === 'review',
    );
    expect(reviews).toHaveLength(1);
    expect(reviews[0].comments).toEqual([
      expect.objectContaining({
        body: 'Why shout?',
        replies: [expect.objectContaining({ body: 'Agreed' })],
      }),
    ]);
    await send('post', `${repo}/pulls/1/comments`, {
      body: 'Lost',
      in_reply_to: 999_999_999,
    }).expect(404);
  });

  it('submits a review with comments on either side and on a range', async () => {
    const { body } = await send('post', `${repo}/pulls/1/reviews`, {
      event: 'REQUEST_CHANGES',
      body: 'Quieter, please',
      commit_id: head,
      comments: [
        { path: 'a.txt', line: 2, side: 'LEFT', body: 'Was fine' },
        {
          path: 'a.txt',
          start_line: 1,
          line: 2,
          body: 'These two',
        },
      ],
    }).expect(200);
    expect(body).toMatchObject({
      id: expect.any(Number),
      node_id: expect.stringMatching(/^PRR_/),
      state: 'CHANGES_REQUESTED',
      body: 'Quieter, please',
      commit_id: head,
      user: expect.objectContaining({ login: `${username}r` }),
    });
    const comments = (
      await get(`${repo}/pulls/1/reviews/${body.id}/comments`).expect(200)
    ).body;
    expect(comments).toEqual([
      expect.objectContaining({
        pull_request_review_id: body.id,
        side: 'LEFT',
        line: 2,
        diff_hunk: expect.stringContaining('-two'),
      }),
      expect.objectContaining({
        side: 'RIGHT',
        start_line: 1,
        start_side: 'RIGHT',
        original_start_line: 1,
        line: 2,
      }),
    ]);
    await get(`${repo}/pulls/1/reviews/999999999/comments`).expect(404);

    // A reply is a comment-only review, which must not displace the verdict before it.
    const { body: still } = await send('post', `${repo}/pulls/1/comments`, {
      body: 'Still',
      in_reply_to: comments[0].id,
    }).expect(201);
    const data = await graphql(`{
      repository(owner: "${username}", name: "tools") {
        pullRequest(number: 1) { reviewDecision latestReviews(first: 10) { nodes { state } } }
      }
    }`);
    expect(data.repository.pullRequest).toEqual({
      // GitHub answers null while no rule on the base asks for reviews.
      reviewDecision: null,
      latestReviews: { nodes: [{ state: 'CHANGES_REQUESTED' }] },
    });
    await send('delete', `${repo}/pulls/comments/${still.id}`, {}).expect(204);
    await get(`${repo}/pulls/1/reviews/${still.pull_request_review_id}`).expect(
      404,
    );
  });

  it('refuses approving your own pull request', async () => {
    await send(
      'post',
      `${repo}/pulls/1/reviews`,
      { event: 'APPROVE' },
      owner.key,
    ).expect(422);
  });

  it('starts a pending review without an event, shows it to its author alone, then submits it', async () => {
    const { body: pending } = await send('post', `${repo}/pulls/1/reviews`, {
      body: 'Draft summary',
      commit_id: older,
      comments: [{ path: 'a.txt', line: 3, body: 'Pending note' }],
    }).expect(200);
    expect(pending).toMatchObject({
      state: 'PENDING',
      body: 'Draft summary',
      submitted_at: null,
      commit_id: older,
    });
    await send('post', `${repo}/pulls/1/reviews`, { body: 'Again' }).expect(
      422,
    );

    const states = async (token: string) =>
      (await get(`${repo}/pulls/1/reviews`, token).expect(200)).body.map(
        (review: { state: string }) => review.state,
      );
    expect(await states(reviewer.key)).toEqual([
      'COMMENTED',
      'COMMENTED',
      'CHANGES_REQUESTED',
      'PENDING',
    ]);
    expect(await states(owner.key)).not.toContain('PENDING');
    const bodies = async (token: string) =>
      (await get(`${repo}/pulls/1/comments`, token).expect(200)).body.map(
        (comment: { body: string }) => comment.body,
      );
    expect(await bodies(reviewer.key)).toContain('Pending note');
    expect(await bodies(owner.key)).not.toContain('Pending note');
    expect(
      (await get(`${repo}/pulls/1/reviews/${pending.id}/comments`).expect(200))
        .body,
    ).toEqual([expect.objectContaining({ body: 'Pending note' })]);
    await get(
      `${repo}/pulls/1/reviews/${pending.id}/comments`,
      owner.key,
    ).expect(404);
    await send(
      'post',
      `${repo}/pulls/1/reviews/${pending.id}/events`,
      { event: 'COMMENT' },
      owner.key,
    ).expect(404);

    const { body: submitted } = await send(
      'post',
      `${repo}/pulls/1/reviews/${pending.id}/events`,
      { event: 'COMMENT' },
    ).expect(200);
    expect(submitted).toMatchObject({
      id: pending.id,
      state: 'COMMENTED',
      body: 'Draft summary',
      submitted_at: expect.any(String),
      commit_id: older,
    });
    expect(await bodies(owner.key)).toContain('Pending note');
    await send('post', `${repo}/pulls/1/reviews/${pending.id}/events`, {
      event: 'COMMENT',
    }).expect(422);
    await send('delete', `${repo}/pulls/1/reviews/${pending.id}`, {}).expect(
      422,
    );
  });

  it('discards a pending review', async () => {
    const { body: pending } = await send('post', `${repo}/pulls/1/reviews`, {
      comments: [{ path: 'a.txt', line: 1, body: 'Scrap' }],
    }).expect(200);
    expect(
      (
        await send(
          'delete',
          `${repo}/pulls/1/reviews/${pending.id}`,
          {},
        ).expect(200)
      ).body,
    ).toMatchObject({ id: pending.id, state: 'PENDING' });
    await get(`${repo}/pulls/1/reviews/${pending.id}`).expect(404);
  });

  it("keeps another reviewer's pending comments out of sight and out of a single comment", async () => {
    await v3()
      .post(
        `/api/repositories/${username}/tools/pulls/1/reviews/pending/comments`,
      )
      .set('cookie', owner.cookie)
      .send({ path: 'a.txt', side: 'additions', line: 3, body: 'Draft' })
      .expect(201);
    await send(
      'post',
      `${repo}/pulls/1/comments`,
      { body: 'Now', commit_id: head, path: 'a.txt', line: 1 },
      owner.key,
    ).expect(201);
    const listed = (await get(`${repo}/pulls/1/comments`).expect(200)).body;
    expect(listed.map((comment: { body: string }) => comment.body)).toEqual([
      'Why shout?',
      'Agreed',
      'Was fine',
      'These two',
      'Pending note',
      'Now',
    ]);
    expect(
      (await get(`${repo}/pulls/1/comments`, owner.key).expect(200)).body.map(
        (comment: { body: string }) => comment.body,
      ),
    ).toContain('Draft');
    const pending = (
      await v3()
        .get(`/api/repositories/${username}/tools/pulls/1/reviews/pending`)
        .set('cookie', owner.cookie)
        .expect(200)
    ).body;
    expect(pending.review.comments).toEqual([
      expect.objectContaining({ body: 'Draft' }),
    ]);
  });

  it('lists across the repository, sorted, from a date, and by page', async () => {
    const newest = (
      await get(`${repo}/pulls/comments?sort=created&direction=desc`).expect(
        200,
      )
    ).body;
    expect(newest[0].body).toBe('Now');
    const updated = (
      await get(`${repo}/pulls/1/comments?sort=updated&direction=asc`).expect(
        200,
      )
    ).body;
    expect(updated[0].body).toBe('Why shout?');
    expect(
      (
        await get(
          `${repo}/pulls/comments?since=${encodeURIComponent(newest[0].updated_at)}`,
        ).expect(200)
      ).body,
    ).toEqual([expect.objectContaining({ body: 'Now' })]);
    const { body, headers } = await get(
      `${repo}/pulls/comments?per_page=2&page=2`,
    ).expect(200);
    expect(body.map((comment: { body: string }) => comment.body)).toEqual([
      'Was fine',
      'These two',
    ]);
    expect(headers.link).toContain('rel="last"');
    await get(`${repo}/pulls/9/comments`).expect(404);
  });

  it('gets, edits and deletes a comment by id', async () => {
    expect(
      (await get(`${repo}/pulls/comments/${first.id}`).expect(200)).body,
    ).toMatchObject({ id: first.id, body: 'Why shout?' });
    await send(
      'patch',
      `${repo}/pulls/comments/${first.id}`,
      { body: 'Mine' },
      owner.key,
    ).expect(403);
    expect(
      (
        await send('patch', `${repo}/pulls/comments/${first.id}`, {
          body: 'Why the shouting?',
        }).expect(200)
      ).body,
    ).toMatchObject({ id: first.id, body: 'Why the shouting?' });
    await send('delete', `${repo}/pulls/comments/${first.id}`, {}).expect(204);
    await get(`${repo}/pulls/comments/${first.id}`).expect(404);
    await get(`${repo}/pulls/comments/${agreed.id}`).expect(404);
    await get(
      `${repo}/pulls/1/reviews/${agreed.pull_request_review_id}`,
    ).expect(404);
    await send('delete', `${repo}/pulls/comments/${first.id}`, {}).expect(404);
  });

  it('takes a write scope to comment', async () => {
    await v3()
      .post(`/api/v3${repo}/pulls/1/comments`)
      .send({ body: 'Hi', commit_id: head, path: 'a.txt', line: 2 })
      .expect(401);
    const readOnly = await scopedKey(app, reviewer.userId, ['read:user']);
    await send(
      'post',
      `${repo}/pulls/1/comments`,
      { body: 'Hi', commit_id: head, path: 'a.txt', line: 2 },
      readOnly,
    ).expect(403);
  });
});
