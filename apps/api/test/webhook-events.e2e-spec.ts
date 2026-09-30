import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database, type Pool, schema } from '@ghost/db';
import { and, eq, ne } from 'drizzle-orm';

import { DATABASE_URL, hasBackends, signUp, startApp } from './harness.js';

type Account = Awaited<ReturnType<typeof signUp>>;

describe.skipIf(!hasBackends)('webhook events', () => {
  let app: INestApplication;
  let origin: string;
  let db: Database;
  let pool: Pool;
  let owner: Account;
  let other: Account;
  let repositoryId: string;
  let work: string;
  const stamp = Date.now();
  const ownerName = `evowner${stamp}`;
  const otherName = `evother${stamp}`;
  const repo = 'events';

  const api = () => request(app.getHttpServer());
  const at = (suffix = '') => `/api/repositories/${ownerName}/${repo}${suffix}`;
  const ok = (response: request.Response) =>
    expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
      { cwd: work, encoding: 'utf8' },
    ).trim();
  const events = () =>
    db
      .select({
        id: schema.outboxEvent.id,
        type: schema.outboxEvent.type,
        actorId: schema.outboxEvent.actorId,
      })
      .from(schema.outboxEvent)
      .where(
        and(
          eq(schema.outboxEvent.repositoryId, repositoryId),
          ne(schema.outboxEvent.type, 'push'),
          ne(schema.outboxEvent.type, 'issue.opened'),
        ),
      );
  /** The ids published so far, to tell a test's own events from earlier ones. */
  const mark = async () => new Set((await events()).map((event) => event.id));
  /** Sorted, since one transaction may publish several at the same instant. */
  const expectPublished = async (
    before: Set<string>,
    expected: [type: string, actor: Account][],
  ) => {
    const byType = (a: { type: string }, b: { type: string }) =>
      a.type.localeCompare(b.type);
    expect(
      (await events())
        .filter((event) => !before.has(event.id))
        .map(({ type, actorId }) => ({ type, actorId }))
        .sort(byType),
    ).toEqual(
      expected
        .map(([type, actor]) => ({ type, actorId: actor.userId }))
        .sort(byType),
    );
  };

  beforeAll(async () => {
    ({ db, pool } = createDatabase({ connectionString: DATABASE_URL }));
    ({ app, origin } = await startApp());
    owner = await signUp(app, ownerName);
    other = await signUp(app, otherName);
    await api()
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: repo, visibility: 'public' })
      .expect(201);
    [{ id: repositoryId }] = await db
      .select({ id: schema.repository.id })
      .from(schema.repository)
      .where(
        and(
          eq(schema.repository.ownerId, owner.userId),
          eq(schema.repository.slug, repo),
        ),
      );

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-events-'));
    git('init', '-q', '-b', 'main');
    writeFileSync(path.join(work, 'a.txt'), 'one\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    git('checkout', '-q', '-b', 'feature');
    writeFileSync(path.join(work, 'a.txt'), 'one\ntwo\n');
    git('commit', '-q', '-am', 'second');
    // The server runs in this process, so the push must not block the event loop.
    await promisify(execFile)(
      'git',
      [
        'push',
        '-q',
        `${origin.replace('://', `://${ownerName}:${owner.key}@`)}/${ownerName}/${repo}.git`,
        'main',
        'feature',
      ],
      { cwd: work, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('publishes a star, an unstar, a watch and a fork once each', async () => {
    const since = await mark();
    for (let i = 0; i < 2; i++) {
      ok(await api().post(at('/star')).set('cookie', other.cookie));
    }
    ok(await api().delete(at('/star')).set('cookie', other.cookie));
    ok(await api().delete(at('/star')).set('cookie', other.cookie));
    for (const level of ['all', 'all', 'ignore']) {
      ok(
        await api()
          .put(at('/subscription'))
          .set('cookie', other.cookie)
          .send({ level }),
      );
    }
    ok(
      await api()
        .post(at('/fork'))
        .set('cookie', other.cookie)
        .send({ name: 'events-fork', visibility: 'public' }),
    );

    await expectPublished(since, [
      ['star.created', other],
      ['star.deleted', other],
      ['watch.started', other],
      ['fork.created', other],
    ]);
  });

  it('publishes a repository edit only when something changed', async () => {
    const since = await mark();
    for (let i = 0; i < 2; i++) {
      ok(
        await api()
          .patch(at())
          .set('cookie', owner.cookie)
          .send({ description: 'Events' }),
      );
    }
    await expectPublished(since, [['repository.edited', owner]]);
  });

  it('publishes label, issue and comment changes', async () => {
    const since = await mark();
    const label = await api()
      .post(at('/labels'))
      .set('cookie', owner.cookie)
      .send({ name: 'bug', color: 'ff0000' });
    ok(label);
    ok(
      await api()
        .patch(at(`/labels/${label.body.id}`))
        .set('cookie', owner.cookie)
        .send({ color: '00ff00' }),
    );
    const issue = await api()
      .post(at('/issues'))
      .set('cookie', owner.cookie)
      .send({ title: 'Bell' });
    ok(issue);
    const thread = at(`/issues/${issue.body.number}`);
    ok(
      await api()
        .patch(thread)
        .set('cookie', owner.cookie)
        .send({ title: 'Bell count' }),
    );
    for (const names of [['bug'], []]) {
      ok(
        await api()
          .put(`${thread}/labels`)
          .set('cookie', owner.cookie)
          .send({ names }),
      );
    }
    for (const usernames of [[ownerName], []]) {
      ok(
        await api()
          .put(`${thread}/assignees`)
          .set('cookie', owner.cookie)
          .send({ usernames }),
      );
    }
    const comment = await api()
      .post(`${thread}/comments`)
      .set('cookie', owner.cookie)
      .send({ body: 'On it' });
    ok(comment);
    ok(
      await api()
        .patch(`${thread}/comments/${comment.body.id}`)
        .set('cookie', owner.cookie)
        .send({ body: 'On it now' }),
    );
    ok(
      await api()
        .delete(`${thread}/comments/${comment.body.id}`)
        .set('cookie', owner.cookie),
    );
    ok(
      await api()
        .delete(at(`/labels/${label.body.id}`))
        .set('cookie', owner.cookie),
    );

    await expectPublished(since, [
      ['label.created', owner],
      ['label.edited', owner],
      ['issue.edited', owner],
      ['issue.labeled', owner],
      ['issue.unlabeled', owner],
      ['issue.assigned', owner],
      ['issue.unassigned', owner],
      ['issue.commented', owner],
      ['issue.comment_edited', owner],
      ['issue.comment_deleted', owner],
      ['label.deleted', owner],
    ]);
  });

  it('publishes draft changes and a dismissed review', async () => {
    const since = await mark();
    const created = await api()
      .post(at('/pulls'))
      .set('cookie', owner.cookie)
      .send({ title: 'Feature', base: 'main', head: 'feature' });
    ok(created);
    const pull = at(`/pulls/${created.body.number}`);
    ok(await api().post(`${pull}/draft`).set('cookie', owner.cookie));
    ok(await api().post(`${pull}/ready`).set('cookie', owner.cookie));
    const review = await api()
      .post(`${pull}/reviews`)
      .set('cookie', other.cookie)
      .send({ state: 'approved' });
    ok(review);
    ok(
      await api()
        .post(`${pull}/reviews/${review.body.id}/dismiss`)
        .set('cookie', owner.cookie)
        .send({ message: 'Stale' }),
    );

    await expectPublished(since, [
      ['pull_request.converted_to_draft', owner],
      ['pull_request.ready_for_review', owner],
      ['pull_request.reviewed', other],
      ['pull_request.review_dismissed', owner],
    ]);
  });

  it('publishes a release created as a draft, published, then deleted', async () => {
    const since = await mark();
    const release = await api()
      .post(at('/releases'))
      .set('cookie', owner.cookie)
      .send({ tagName: 'v1', isDraft: true });
    ok(release);
    for (let i = 0; i < 2; i++) {
      ok(
        await api()
          .patch(at(`/releases/${release.body.id}`))
          .set('cookie', owner.cookie)
          .send({ isDraft: false }),
      );
    }
    ok(
      await api()
        .delete(at(`/releases/${release.body.id}`))
        .set('cookie', owner.cookie),
    );
    ok(
      await api()
        .post(at('/releases'))
        .set('cookie', owner.cookie)
        .send({ tagName: 'v2' }),
    );

    await expectPublished(since, [
      ['release.created', owner],
      ['release.edited', owner],
      ['release.published', owner],
      ['release.edited', owner],
      ['release.deleted', owner],
      ['release.created', owner],
      ['release.published', owner],
    ]);
  });

  it('publishes members joining and leaving, but not a withdrawn invitation', async () => {
    const since = await mark();
    const invite = async () =>
      ok(
        await api()
          .put(at(`/collaborators/${otherName}`))
          .set('cookie', owner.cookie)
          .send({ role: 'read' }),
      );
    const remove = async () =>
      ok(
        await api()
          .delete(at(`/collaborators/${otherName}`))
          .set('cookie', owner.cookie),
      );

    await invite();
    await remove();
    await invite();
    const { body } = await api()
      .get('/api/invitations')
      .set('cookie', other.cookie)
      .expect(200);
    ok(
      await api()
        .post(`/api/invitations/${body.invitations[0].id}/accept`)
        .set('cookie', other.cookie),
    );
    await remove();

    await expectPublished(since, [
      ['member.added', other],
      ['member.removed', owner],
    ]);
  });

  it('publishes a transfer once the recipient accepts', async () => {
    const since = await mark();
    ok(
      await api()
        .post(at('/transfer'))
        .set('cookie', owner.cookie)
        .send({ owner: otherName }),
    );
    await expectPublished(since, []);
    ok(
      await api()
        .post(`/api/transfers/${repositoryId}/accept`)
        .set('cookie', other.cookie),
    );

    await expectPublished(since, [['repository.transferred', other]]);
    const [event] = await db
      .select({ payload: schema.outboxEvent.payload })
      .from(schema.outboxEvent)
      .where(
        and(
          eq(schema.outboxEvent.repositoryId, repositoryId),
          eq(schema.outboxEvent.type, 'repository.transferred'),
        ),
      );
    expect(event.payload).toEqual({ from: ownerName });
  });
});
