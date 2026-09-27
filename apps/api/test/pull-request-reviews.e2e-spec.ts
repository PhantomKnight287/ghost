import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)('pull request reviews and drafts', () => {
  let app: INestApplication;
  let origin: string;
  let author: { cookie: string; key: string };
  let reviewer: { cookie: string; key: string };
  let bystander: { cookie: string; key: string; username: string };
  let work: string;
  const owner = `author${Date.now()}`;
  const other = `reviewer${Date.now()}`;
  let repo: string;

  const api = () => request(app.getHttpServer());
  const pull = (suffix = '') =>
    `/api/repositories/${owner}/${repo}/pulls/1${suffix}`;
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
      { cwd: work, encoding: 'utf8' },
    ).trim();
  // The server runs in this process, so anything that talks to it must not block the event loop.
  const remote = (verb: 'push' | 'fetch', ...refs: string[]) =>
    promisify(execFile)(
      'git',
      [
        verb,
        '-q',
        `${origin.replace('://', `://${owner}:${author.key}@`)}/${owner}/${repo}.git`,
        ...refs,
      ],
      { cwd: work, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
  const push = (...refs: string[]) => remote('push', ...refs);
  const review = (cookie: string, body: object) =>
    api().post(pull('/reviews')).set('cookie', cookie).send(body);

  beforeAll(async () => {
    ({ app, origin } = await startApp());
    author = await signUp(app, owner);
    reviewer = await signUp(app, other);
    const bystanderName = `bystander${Date.now()}`;
    bystander = {
      ...(await signUp(app, bystanderName)),
      username: bystanderName,
    };

    repo = (
      await api()
        .post('/api/repositories')
        .set('cookie', author.cookie)
        .send({ name: 'reviewed', visibility: 'public' })
        .expect(201)
    ).body.slug;
    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-review-'));
    git('init', '-q', '-b', 'main');
    writeFileSync(path.join(work, 'a.txt'), 'one\n');
    // Twenty lines changed at both ends diff as two hunks.
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    writeFileSync(path.join(work, 'b.txt'), `${lines.join('\n')}\n`);
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    git('checkout', '-q', '-b', 'feature');
    writeFileSync(path.join(work, 'a.txt'), 'one\ntwo\n');
    writeFileSync(
      path.join(work, 'b.txt'),
      `${['first', ...lines.slice(1, -1), 'last'].join('\n')}\n`,
    );
    git('commit', '-q', '-am', 'second');
    await push('main', 'feature');

    await api()
      .post(`/api/repositories/${owner}/${repo}/pulls`)
      .set('cookie', author.cookie)
      .send({ title: 'Feature', base: 'main', head: 'feature', draft: true })
      .expect(201)
      .expect(({ body }) => expect(body.draft).toBe(true));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('refuses to merge a draft, and lets only the author or a writer mark it ready', async () => {
    const merge = await api()
      .post(pull('/merge'))
      .set('cookie', author.cookie)
      .send({})
      .expect(409);
    expect(merge.body.message).toContain('draft');
    expect((await api().get(pull()).expect(200)).body.mergeable).toBe(false);

    await api().post(pull('/ready')).set('cookie', reviewer.cookie).expect(403);
    const ready = await api()
      .post(pull('/ready'))
      .set('cookie', author.cookie)
      .expect(201);
    expect(ready.body.draft).toBe(false);
    // A second call changes nothing and records nothing.
    await api().post(pull('/ready')).set('cookie', author.cookie).expect(201);

    const { body } = await api().get(pull()).expect(200);
    expect(body.draft).toBe(false);
  });

  it('rejects reviews that say nothing, verdicts on your own request, and lines outside the diff', async () => {
    await review(author.cookie, { state: 'approved' }).expect(400);
    await review(reviewer.cookie, { state: 'commented', body: '  ' }).expect(
      400,
    );
    for (const [path, side, line] of [
      ['missing.txt', 'additions', 1],
      ['a.txt', 'additions', 3],
      ['a.txt', 'deletions', 2],
    ] as const) {
      const stray = await review(reviewer.cookie, {
        state: 'commented',
        comments: [{ path, side, line, body: 'x' }],
      }).expect(400);
      expect(stray.body.message).toContain(`${path}:${line}`);
    }
  });

  it('keeps pending comments private until the review is submitted, then records what they mention', async () => {
    await api()
      .post(`/api/repositories/${owner}/${repo}/issues`)
      .set('cookie', author.cookie)
      .send({ title: 'Tracked' })
      .expect(201);
    const mentions = async () =>
      (
        await api()
          .get(`/api/repositories/${owner}/${repo}/issues/2/timeline`)
          .expect(200)
      ).body.timeline.filter(
        (item: { kind: string }) => item.kind === 'reference',
      );

    const added = await api()
      .post(pull('/reviews/pending/comments'))
      .set('cookie', reviewer.cookie)
      .send({ path: 'a.txt', side: 'additions', line: 2, body: 'See #2' })
      .expect(201);
    expect(added.body.review).toMatchObject({
      state: null,
      comments: [{ line: 2, body: 'See #2' }],
    });
    const pendingId = added.body.review.comments[0].id;

    const { body: others } = await api()
      .get(pull('/reviews/pending'))
      .set('cookie', bystander.cookie)
      .expect(200);
    expect(others.review).toBeNull();
    await api()
      .patch(pull(`/comments/${pendingId}`))
      .set('cookie', author.cookie)
      .send({ body: 'x' })
      .expect(404);
    await api()
      .post(pull(`/comments/${pendingId}/replies`))
      .set('cookie', reviewer.cookie)
      .send({ body: 'x' })
      .expect(409);
    expect(await mentions()).toEqual([]);

    // Discarding throws the batch away; the next comment starts a new one.
    await api()
      .delete(pull('/reviews/pending'))
      .set('cookie', reviewer.cookie)
      .expect(200);
    expect(
      (
        await api()
          .get(pull('/reviews/pending'))
          .set('cookie', reviewer.cookie)
          .expect(200)
      ).body.review,
    ).toBeNull();
    await api()
      .post(pull('/reviews/pending/comments'))
      .set('cookie', reviewer.cookie)
      .send({ path: 'a.txt', side: 'additions', line: 2, body: 'See #2' })
      .expect(201);

    const submitted = await review(reviewer.cookie, {
      state: 'changes_requested',
      body: 'Needs work',
    }).expect(201);
    expect(submitted.body).toMatchObject({
      kind: 'review',
      state: 'changes_requested',
      authorUsername: other,
      comments: [
        {
          path: 'a.txt',
          side: 'additions',
          line: 2,
          body: 'See #2',
          authorUsername: other,
          diffHunk: '@@ -1,1 +1,2 @@\n one\n+two',
          replies: [],
        },
      ],
    });
    expect(
      (
        await api()
          .get(pull('/reviews/pending'))
          .set('cookie', reviewer.cookie)
          .expect(200)
      ).body.review,
    ).toBeNull();
    expect(await mentions()).toHaveLength(1);
  });

  it('threads replies, and limits editing and deleting to the author or a writer', async () => {
    const { body } = await api()
      .get(`/api/repositories/${owner}/${repo}/issues/1/timeline`)
      .expect(200);
    const [thread] = body.timeline.find(
      (item: { kind: string }) => item.kind === 'review',
    ).comments;

    const first = await api()
      .post(pull(`/comments/${thread.id}/replies`))
      .set('cookie', author.cookie)
      .send({ body: 'Fixed' })
      .expect(201);
    expect(first.body).toMatchObject({ body: 'Fixed', authorUsername: owner });
    // A reply to a reply joins the same thread.
    await api()
      .post(pull(`/comments/${first.body.id}/replies`))
      .set('cookie', bystander.cookie)
      .send({ body: 'Nice' })
      .expect(201);

    await api()
      .patch(pull(`/comments/${first.body.id}`))
      .set('cookie', bystander.cookie)
      .send({ body: 'x' })
      .expect(403);
    const edited = await api()
      .patch(pull(`/comments/${thread.id}`))
      .set('cookie', author.cookie)
      .send({ body: 'Edited by a writer' })
      .expect(200);
    expect(edited.body).toMatchObject({
      body: 'Edited by a writer',
      authorUsername: other,
    });

    const reviewId = body.timeline.find(
      (item: { kind: string }) => item.kind === 'review',
    ).id;
    await api()
      .patch(pull(`/reviews/${reviewId}`))
      .set('cookie', bystander.cookie)
      .send({ body: 'x' })
      .expect(403);
    await api()
      .patch(pull(`/reviews/${reviewId}`))
      .set('cookie', reviewer.cookie)
      .send({ body: 'Still needs work' })
      .expect(200);

    const { body: after } = await api()
      .get(`/api/repositories/${owner}/${repo}/issues/1/timeline`)
      .expect(200);
    const reviewed = after.timeline.find(
      (item: { kind: string }) => item.kind === 'review',
    );
    expect(reviewed.body).toBe('Still needs work');
    expect(
      reviewed.comments[0].replies.map((r: { body: string }) => r.body),
    ).toEqual(['Fixed', 'Nice']);

    await api()
      .delete(pull(`/comments/${first.body.id}`))
      .set('cookie', bystander.cookie)
      .expect(403);
    await api()
      .delete(pull(`/comments/${first.body.id}`))
      .set('cookie', author.cookie)
      .expect(200);
  });

  it('drops a comment-only review once its last comment is deleted', async () => {
    const { body } = await review(bystander.cookie, {
      state: 'commented',
      comments: [
        { path: 'a.txt', side: 'deletions', line: 1, body: 'Old line' },
      ],
    }).expect(201);
    await api()
      .delete(pull(`/comments/${body.comments[0].id}`))
      .set('cookie', bystander.cookie)
      .expect(200);
    await api()
      .patch(pull(`/reviews/${body.id}`))
      .set('cookie', bystander.cookie)
      .send({ body: 'x' })
      .expect(404);
  });

  it('counts each reviewer’s latest verdict until a writer dismisses it', async () => {
    const approval = await review(reviewer.cookie, {
      state: 'approved',
    }).expect(201);
    expect((await api().get(pull()).expect(200)).body.reviewers).toEqual([
      // signUp gives no avatar
      { username: other, image: null, state: 'approved' },
    ]);

    await api()
      .post(pull(`/reviews/${approval.body.id}/dismiss`))
      .set('cookie', reviewer.cookie)
      .send({ message: 'no' })
      .expect(403);
    const dismissed = await api()
      .post(pull(`/reviews/${approval.body.id}/dismiss`))
      .set('cookie', author.cookie)
      .send({ message: 'Stale' })
      .expect(201);
    expect(dismissed.body).toMatchObject({
      dismissedByUsername: owner,
      dismissalMessage: 'Stale',
    });
    await api()
      .post(pull(`/reviews/${approval.body.id}/dismiss`))
      .set('cookie', author.cookie)
      .send({ message: 'Again' })
      .expect(409);

    // The older request for changes does not come back.
    expect((await api().get(pull()).expect(200)).body.reviewers).toEqual([]);
  });

  it('turns a request back into a draft for the author or a writer, and records it', async () => {
    await api()
      .post(pull('/draft'))
      .set('cookie', bystander.cookie)
      .expect(403);
    const draft = await api()
      .post(pull('/draft'))
      .set('cookie', author.cookie)
      .expect(201);
    expect(draft.body.draft).toBe(true);
    await api()
      .post(pull('/merge'))
      .set('cookie', author.cookie)
      .send({})
      .expect(409);
    await api().post(pull('/ready')).set('cookie', author.cookie).expect(201);

    const { body } = await api()
      .get(`/api/repositories/${owner}/${repo}/issues/1/timeline`)
      .expect(200);
    const events = body.timeline
      .filter((item: { kind: string }) => item.kind === 'event')
      .map((item: { event: { type: string } }) => item.event.type);
    expect(events).toEqual([
      'opened',
      'ready_for_review',
      'converted_to_draft',
      'ready_for_review',
    ]);
  });

  it('comments on a range of lines, which must start before it ends and sit inside the diff', async () => {
    const range = (startLine: number, line: number) =>
      review(bystander.cookie, {
        state: 'commented',
        comments: [
          {
            path: 'a.txt',
            side: 'additions',
            line,
            startLine,
            body: 'Both lines',
          },
        ],
      });
    await range(2, 1).expect(400);
    await range(3, 2).expect(400);
    const { body } = await range(1, 2).expect(201);
    expect(body.comments[0]).toMatchObject({
      startLine: 1,
      startSide: null,
      line: 2,
    });
  });

  it('applies a suggestion as a commit on the head branch for someone who can write to it', async () => {
    const { body } = await review(bystander.cookie, {
      state: 'commented',
      comments: [
        {
          path: 'a.txt',
          side: 'additions',
          line: 2,
          body: 'Shout it:\n```suggestion\nTWO\n```',
        },
      ],
    }).expect(201);
    const suggestion = body.comments[0].id;
    const plain = (
      await review(bystander.cookie, {
        state: 'commented',
        comments: [
          {
            path: 'a.txt',
            side: 'deletions',
            line: 1,
            body: '```suggestion\nx\n```',
          },
        ],
      }).expect(201)
    ).body.comments[0].id;

    await api()
      .post(pull(`/comments/${suggestion}/apply`))
      .set('cookie', bystander.cookie)
      .expect(403);
    await api()
      .post(pull(`/comments/${plain}/apply`))
      .set('cookie', author.cookie)
      .expect(400);

    const applied = await api()
      .post(pull(`/comments/${suggestion}/apply`))
      .set('cookie', author.cookie)
      .expect(201);
    expect((await api().get(pull()).expect(200)).body.headSha).toBe(
      applied.body.commitSha,
    );
    const commits = await api().get(pull('/commits')).expect(200);
    expect(commits.body.commits[0]).toMatchObject({
      sha: applied.body.commitSha,
      subject: `Apply suggestion from ${bystander.username}`,
    });
    const patch = await api()
      .get(pull('/patch'))
      .query({ path: 'a.txt' })
      .expect(200);
    expect(patch.text).toContain('+TWO');

    // The branch has moved past the commit the suggestion was made on.
    await api()
      .post(pull(`/comments/${suggestion}/apply`))
      .set('cookie', author.cookie)
      .expect(409);
  });

  it('keeps a range inside one hunk, so it never covers lines the diff hides', async () => {
    const { body } = await review(bystander.cookie, {
      state: 'commented',
      comments: [
        {
          path: 'b.txt',
          side: 'additions',
          startLine: 1,
          line: 20,
          body: 'All of it',
        },
      ],
    }).expect(400);
    expect(body.message).toContain('b.txt:1');
  });

  it('closes reviews once the request is merged', async () => {
    await api()
      .post(pull('/merge'))
      .set('cookie', author.cookie)
      .send({})
      .expect(201);
    await review(reviewer.cookie, { state: 'approved' }).expect(409);
  });

  it('names the files a conflicting request clashes on, and refuses to merge it', async () => {
    await remote('fetch', 'main');
    git('checkout', '-q', '-B', 'main', 'FETCH_HEAD');
    git('checkout', '-q', '-b', 'clash');
    writeFileSync(path.join(work, 'a.txt'), 'uno\n');
    git('commit', '-q', '-am', 'clash side');
    git('checkout', '-q', 'main');
    writeFileSync(path.join(work, 'a.txt'), 'ONE\n');
    git('commit', '-q', '-am', 'main side');
    await push('main', 'clash');

    const { body: opened } = await api()
      .post(`/api/repositories/${owner}/${repo}/pulls`)
      .set('cookie', author.cookie)
      .send({ title: 'Clash', base: 'main', head: 'clash' })
      .expect(201);
    const at = `/api/repositories/${owner}/${repo}/pulls/${opened.number}`;

    const { body } = await api().get(at).expect(200);
    expect(body).toMatchObject({ mergeable: false, conflicts: ['a.txt'] });
    const merge = await api()
      .post(`${at}/merge`)
      .set('cookie', author.cookie)
      .send({})
      .expect(409);
    expect(merge.body.message).toContain('a.txt');
  });
});
