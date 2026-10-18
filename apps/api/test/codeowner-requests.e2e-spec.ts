import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { type Database, schema } from '@ghost/db';
import { type INestApplication, Logger } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import type { Auth } from '../src/lib/auth.js';
import type { StoredEvent } from '../src/lib/events/events.js';
import { CodeownerRequestsService } from '../src/services/codeowners/codeowner-requests.service.js';
import { hasBackends, signUp, startApp } from './harness.js';

type Account = Awaited<ReturnType<typeof signUp>>;

describe.skipIf(!hasBackends)('automatic code-owner review requests', () => {
  let app: INestApplication;
  let origin: string;
  let owner: Account;
  let reviewer: Account;
  let other: Account;
  let work: string;
  let repositoryId: string;
  const stamp = Date.now();
  const ownerName = `crowner${stamp}`;
  const reviewerName = `crreviewer${stamp}`;
  const otherName = `crother${stamp}`;
  const org = `crorg${stamp}`;
  const repo = `${org}/owned`;

  const api = () => request(app.getHttpServer());
  const db = () => app.get<Database>(DATABASE);
  const auth = () => app.get<AuthService<Auth>>(AuthService).api;
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
      { cwd: work, encoding: 'utf8' },
    ).trim();
  // The server runs in this process, so anything that talks to it must not block the event loop.
  const push = (branch: string, source = 'HEAD') =>
    promisify(execFile)(
      'git',
      [
        'push',
        '-q',
        '-f',
        `${origin.replace('://', `://${ownerName}:${owner.key}@`)}/${repo}.git`,
        `${source}:${branch}`,
      ],
      { cwd: work, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
  const commit = (files: Record<string, string>) => {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
      writeFileSync(path.join(work, file), text);
    }
    git('add', '-A');
    git('commit', '-q', '-m', 'files');
  };
  const branch = (name: string, from = 'main') =>
    git('checkout', '-q', '-B', name, from);
  const openPull = async (head: string, extra: object = {}) =>
    (
      await api()
        .post(`/api/repositories/${repo}/pulls`)
        .set('cookie', owner.cookie)
        .send({ title: head, base: 'main', head, ...extra })
        .expect(201)
    ).body.number as number;
  const pull = (number: number, suffix = '') =>
    `/api/repositories/${repo}/pulls/${number}${suffix}`;
  // The server records a push to a pull request after answering it.
  const synchronize = async (branch: string) => {
    await push(branch);
    const after = git('rev-parse', 'HEAD');
    await vi.waitFor(
      async () => {
        const events = await db()
          .select({ id: schema.outboxEvent.id })
          .from(schema.outboxEvent)
          .where(
            and(
              eq(schema.outboxEvent.type, 'pull_request.synchronized'),
              eq(sql`${schema.outboxEvent.payload}->>'after'`, after),
            ),
          );
        expect(events).toHaveLength(1);
      },
      { timeout: 15_000, interval: 100 },
    );
  };
  // Requests are made off the outbox, after the change that triggered them has committed.
  const settle = () =>
    vi.waitFor(
      async () => {
        const pending = await db()
          .select({ id: schema.outboxEvent.id })
          .from(schema.outboxEvent)
          .where(
            and(
              eq(schema.outboxEvent.repositoryId, repositoryId),
              isNull(schema.outboxEvent.processedAt),
            ),
          );
        expect(pending).toEqual([]);
      },
      { timeout: 15_000, interval: 100 },
    );
  const requested = async (number: number) => {
    await settle();
    return (
      await api().get(pull(number, '/requested-reviewers')).expect(200)
    ).body.users.map((user: { username: string; asCodeOwner: boolean }) => [
      user.username,
      user.asCodeOwner,
    ]);
  };
  const rows = async (number: number) =>
    db()
      .select({ id: schema.pullRequestReviewRequest.id })
      .from(schema.pullRequestReviewRequest)
      .innerJoin(
        schema.pullRequest,
        eq(
          schema.pullRequest.id,
          schema.pullRequestReviewRequest.pullRequestId,
        ),
      )
      .innerJoin(schema.issue, eq(schema.issue.id, schema.pullRequest.issueId))
      .where(
        and(
          eq(schema.issue.repositoryId, repositoryId),
          eq(schema.issue.number, number),
        ),
      );
  const collaborate = async (account: Account, username: string) => {
    await api()
      .put(`/api/repositories/${repo}/collaborators/${username}`)
      .set('cookie', owner.cookie)
      .send({ role: 'write' })
      .expect(200);
    const invitation = (
      await api()
        .get('/api/invitations')
        .set('cookie', account.cookie)
        .expect(200)
    ).body.invitations[0];
    await api()
      .post(`/api/invitations/${invitation.id}/accept`)
      .set('cookie', account.cookie)
      .expect(204);
  };

  beforeAll(async () => {
    ({ app, origin } = await startApp());
    owner = await signUp(app, ownerName);
    reviewer = await signUp(app, reviewerName);
    other = await signUp(app, otherName);
    const { id: organizationId } = (await auth().createOrganization({
      body: { name: 'Code Owners', slug: org },
      headers: new Headers({ cookie: owner.cookie }),
    }))!;
    repositoryId = (
      await api()
        .post('/api/repositories')
        .set('cookie', owner.cookie)
        .send({ name: 'owned', organization: org, visibility: 'public' })
        .expect(201)
    ).body.id;
    await collaborate(reviewer, reviewerName);
    await collaborate(other, otherName);
    const team = await auth().createTeam({
      body: { name: 'Core', organizationId },
      headers: new Headers({ cookie: owner.cookie }),
    });
    await api()
      .put(`/api/repositories/${repo}/teams/${team!.id}`)
      .set('cookie', owner.cookie)
      .send({ role: 'write' })
      .expect(204);

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-codeowner-requests-'));
    git('init', '-q', '-b', 'main');
    commit({
      CODEOWNERS: `*.txt @${reviewerName}\n*.md @${otherName}\n*.go @${org}/core\n`,
      'a.txt': 'a\n',
    });
    await push('main');
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('requests the owners of changed files when a pull request opens, once however often the event is handled', async () => {
    branch('opened');
    commit({ 'a.txt': 'a\nopened\n' });
    await push('opened');
    const number = await openPull('opened');

    expect(await requested(number)).toEqual([[reviewerName, true]]);
    const timeline = (
      await api()
        .get(`/api/repositories/${repo}/issues/${number}/timeline`)
        .expect(200)
    ).body.timeline.filter(
      (entry: { event?: { type: string } }) =>
        entry.event?.type === 'review_requested',
    );
    expect(timeline).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({
          actorUsername: ownerName,
          requestedReviewerUsername: reviewerName,
        }),
      }),
    ]);

    const [opened] = await db()
      .select()
      .from(schema.outboxEvent)
      .where(
        and(
          eq(schema.outboxEvent.repositoryId, repositoryId),
          eq(schema.outboxEvent.type, 'issue.opened'),
        ),
      );
    const consumer = app.get(CodeownerRequestsService);
    await consumer.handle(opened as unknown as StoredEvent);
    await consumer.handle(opened as unknown as StoredEvent);
    expect(await rows(number)).toHaveLength(1);
  });

  it('requests only owners never requested before when a push changes files', async () => {
    branch('pushed');
    commit({ 'a.txt': 'a\npushed\n' });
    await push('pushed');
    const number = await openPull('pushed');
    expect(await requested(number)).toEqual([[reviewerName, true]]);

    await api()
      .post(pull(number, '/reviews'))
      .set('cookie', reviewer.cookie)
      .send({ state: 'commented', body: 'Looks fine' })
      .expect(201);
    commit({ 'c.txt': 'c\n' });
    await synchronize('pushed');
    expect(await requested(number)).toEqual([]);

    commit({ 'b.md': 'b\n' });
    await synchronize('pushed');
    expect(await requested(number)).toEqual([[otherName, true]]);

    await api()
      .delete(pull(number, '/requested-reviewers'))
      .set('cookie', owner.cookie)
      .send({ users: [otherName] })
      .expect(200);
    commit({ 'd.md': 'd\n' });
    await synchronize('pushed');
    expect(await requested(number)).toEqual([]);
    expect(await rows(number)).toHaveLength(2);
  });

  it('requests an owning team as the team', async () => {
    branch('teamed');
    commit({ 'h.go': 'package h\n' });
    await push('teamed');
    const number = await openPull('teamed');
    expect(await requested(number)).toEqual([]);
    const { body } = await api()
      .get(pull(number, '/requested-reviewers'))
      .expect(200);
    expect(body.teams).toEqual([
      expect.objectContaining({ slug: 'core', asCodeOwner: true }),
    ]);
  });

  it('waits for a draft to be marked ready', async () => {
    branch('drafted');
    commit({ 'a.txt': 'a\ndrafted\n' });
    await push('drafted');
    const number = await openPull('drafted', { draft: true });
    expect(await requested(number)).toEqual([]);

    commit({ 'e.txt': 'e\n' });
    await synchronize('drafted');
    expect(await requested(number)).toEqual([]);

    await api()
      .post(pull(number, '/ready'))
      .set('cookie', owner.cookie)
      .expect(201);
    expect(await requested(number)).toEqual([[reviewerName, true]]);
  });

  it('reads owners from the base branch, not from the pull request', async () => {
    branch('takeover');
    commit({ '.ghost/CODEOWNERS': `* @${otherName}\n`, 'x.c': 'x\n' });
    await push('takeover');
    const number = await openPull('takeover');
    expect(await requested(number)).toEqual([]);
  });

  it('still opens the pull request, and requests from the lines that work, when the base CODEOWNERS is malformed', async () => {
    branch('broken');
    commit({
      CODEOWNERS: `[ab].txt @${otherName}\n*.txt @@nobody\n*.md @${reviewerName}\n`,
    });
    await push('broken');
    branch('fix', 'broken');
    commit({ 'f.md': 'f\n', 'b.txt': 'b\n' });
    await push('fix');
    const number = await openPull('fix', { base: 'broken' });
    expect(await requested(number)).toEqual([[reviewerName, true]]);
  });

  it('requests nobody when the base branch has no CODEOWNERS file', async () => {
    branch('unowned');
    git('rm', '-q', 'CODEOWNERS');
    git('commit', '-q', '-m', 'unowned');
    await push('unowned');
    branch('unowned-change', 'unowned');
    commit({ 'a.txt': 'a\nunowned\n' });
    await push('unowned-change');
    const number = await openPull('unowned-change', { base: 'unowned' });
    expect(await requested(number)).toEqual([]);
  });

  it('requests nobody once the base shares no history with the head', async () => {
    branch('rewritten');
    await push('rewritten');
    branch('rewritten-change', 'rewritten');
    commit({ 'a.txt': 'a\nrewritten\n' });
    await push('rewritten-change');
    const number = await openPull('rewritten-change', { base: 'rewritten' });
    expect(await requested(number)).toEqual([[reviewerName, true]]);

    git('checkout', '-q', '--orphan', 'orphan');
    git('rm', '-rq', '--cached', '.');
    commit({ CODEOWNERS: `*.md @${otherName}\n` });
    await push('rewritten');
    git('checkout', '-q', '-f', 'rewritten-change');
    commit({ 'g.md': 'g\n' });
    await synchronize('rewritten-change');
    expect(await requested(number)).toEqual([[reviewerName, true]]);
  });

  it('logs, and lets the event through, when the pull request cannot be read', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn');
    branch('vanishing');
    commit({ 'a.txt': 'a\nvanishing\n' });
    await push('vanishing');
    const number = await openPull('vanishing', { draft: true });
    await push('vanishing', '');
    await api()
      .post(pull(number, '/ready'))
      .set('cookie', owner.cookie)
      .expect(201);
    expect(await requested(number)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Code-owner requests for event .+ \(pull_request\.ready_for_review\) failed: /,
      ),
    );
    const failed = await db()
      .select({ id: schema.outboxEvent.id })
      .from(schema.outboxEvent)
      .where(
        and(
          eq(schema.outboxEvent.repositoryId, repositoryId),
          isNotNull(schema.outboxEvent.lastError),
        ),
      );
    expect(failed).toEqual([]);
    warn.mockRestore();
  });
});
