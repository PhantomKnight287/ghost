import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { type Database, schema } from '@ghost/db';
import type { INestApplication } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import { hasBackends, signUp, startApp } from './harness.js';

type Account = Awaited<ReturnType<typeof signUp>> & { username: string };

/** Resolving review threads: who may, what it records, and how it shows in Ghost's API and in GitHub's GraphQL. */
describe.skipIf(!hasBackends)('review threads', () => {
  let app: INestApplication;
  let origin: string;
  let owner: Account;
  let author: Account;
  let writer: Account;
  let commenter: Account;
  let work: string;
  let repositoryId: string;
  let number: number;
  let otherNumber: number;
  const stamp = Date.now();
  const repoName = 'threaded';
  let repo: string;
  let counter = 0;

  const api = () => request(app.getHttpServer());
  const db = () => app.get<Database>(DATABASE);
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
      { cwd: work, encoding: 'utf8' },
    ).trim();
  // The server runs in this process, so anything that talks to it must not block the event loop.
  const push = (...refs: string[]) =>
    promisify(execFile)(
      'git',
      [
        'push',
        '-q',
        '-f',
        `${origin.replace('://', `://${owner.username}:${owner.key}@`)}/${repo}.git`,
        ...refs,
      ],
      { cwd: work, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
  const pull = (n: number, suffix = '') =>
    `/api/repositories/${repo}/pulls/${n}${suffix}`;
  const account = async (username: string): Promise<Account> => ({
    ...(await signUp(app, username)),
    username,
  });
  const collaborate = async (who: Account, role: string) => {
    await api()
      .put(`/api/repositories/${repo}/collaborators/${who.username}`)
      .set('cookie', owner.cookie)
      .send({ role })
      .expect(200);
    const invitation = (
      await api().get('/api/invitations').set('cookie', who.cookie).expect(200)
    ).body.invitations[0];
    await api()
      .post(`/api/invitations/${invitation.id}/accept`)
      .set('cookie', who.cookie)
      .expect(204);
  };
  /** A new thread on line 1 of `notes.txt`; returns its root comment id. */
  const thread = async (who: Account = commenter, n = number) => {
    const { body } = await api()
      .post(pull(n, '/reviews'))
      .set('cookie', who.cookie)
      .send({
        state: 'commented',
        comments: [
          {
            path: 'notes.txt',
            side: 'additions',
            line: 1,
            body: `thread ${++counter}`,
          },
        ],
      })
      .expect(201);
    return body.comments[0].id as string;
  };
  const resolve = (who: Account, commentId: string, n = number) =>
    api().post(pull(n, `/comments/${commentId}/resolve`)).set('cookie', who.cookie);
  const unresolve = (who: Account, commentId: string, n = number) =>
    api().post(pull(n, `/comments/${commentId}/unresolve`)).set('cookie', who.cookie);
  const outbox = (type: string, commentId: string) =>
    db()
      .select({ payload: schema.outboxEvent.payload, actorId: schema.outboxEvent.actorId })
      .from(schema.outboxEvent)
      .where(
        and(
          eq(schema.outboxEvent.repositoryId, repositoryId),
          eq(schema.outboxEvent.type, type),
          eq(sql`${schema.outboxEvent.payload}->>'commentId'`, commentId),
        ),
      );
  /** The thread as the timeline shows it. */
  const shown = async (commentId: string) => {
    const { body } = await api()
      .get(`/api/repositories/${repo}/issues/${number}/timeline`)
      .expect(200);
    return body.timeline
      .filter((item: { kind: string }) => item.kind === 'review')
      .flatMap((item: { comments: { id: string }[] }) => item.comments)
      .find((comment: { id: string }) => comment.id === commentId);
  };
  const graphql = (query: string, variables: object, who: Account) =>
    api()
      .post('/api/graphql')
      .set('authorization', `token ${who.key}`)
      .send({ query, variables })
      .expect(200);
  const THREAD_FIELDS =
    'id isResolved isOutdated isCollapsed path line startLine diffSide viewerCanResolve viewerCanUnresolve resolvedBy { login } comments(first: 10) { totalCount nodes { body author { login } } }';
  const threadsOf = async (who: Account) => {
    const { body } = await graphql(
      `query($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            reviewThreads(first: 50) { totalCount nodes { ${THREAD_FIELDS} } }
          }
        }
      }`,
      { owner: owner.username, name: repoName, number },
      who,
    );
    expect(body.errors).toBeUndefined();
    return body.data.repository.pullRequest.reviewThreads;
  };
  const threadNode = async (who: Account, text: string) =>
    (await threadsOf(who)).nodes.find(
      (node: { comments: { nodes: { body: string }[] } }) =>
        node.comments.nodes[0]?.body === text,
    );

  beforeAll(async () => {
    ({ app, origin } = await startApp());
    owner = await account(`rtowner${stamp}`);
    author = await account(`rtauthor${stamp}`);
    writer = await account(`rtwriter${stamp}`);
    commenter = await account(`rtcommenter${stamp}`);
    repo = `${owner.username}/${repoName}`;
    repositoryId = (
      await api()
        .post('/api/repositories')
        .set('cookie', owner.cookie)
        .send({ name: repoName, visibility: 'public' })
        .expect(201)
    ).body.id;
    await collaborate(author, 'write');
    await collaborate(writer, 'write');

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-review-threads-'));
    git('init', '-q', '-b', 'main');
    writeFileSync(path.join(work, 'a.txt'), 'a\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    for (const branch of ['notes', 'other-notes']) {
      git('checkout', '-q', '-B', branch, 'main');
      writeFileSync(path.join(work, 'notes.txt'), `one ${branch}\ntwo\n`);
      git('add', '.');
      git('commit', '-q', '-m', `notes on ${branch}`);
    }
    await push('main', 'notes', 'other-notes');
    for (const head of ['notes', 'other-notes']) {
      const opened = await api()
        .post(`/api/repositories/${repo}/pulls`)
        .set('cookie', author.cookie)
        .send({ title: head, base: 'main', head })
        .expect(201);
      if (head === 'notes') number = opened.body.number;
      else otherNumber = opened.body.number;
    }
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  describe("Ghost's API", () => {
    it('shows a new thread as unresolved', async () => {
      const id = await thread();
      expect(await shown(id)).toMatchObject({ resolved: false, resolvedBy: null });
    });

    it('lets the pull request author resolve and unresolve a thread', async () => {
      const id = await thread();

      const resolved = await resolve(author, id).expect(200);
      expect(resolved.body).toMatchObject({
        resolved: true,
        resolvedBy: { username: author.username },
      });
      expect(await shown(id)).toMatchObject({
        resolved: true,
        resolvedBy: { username: author.username },
      });

      const reopened = await unresolve(author, id).expect(200);
      expect(reopened.body).toMatchObject({ resolved: false, resolvedBy: null });
      expect(await shown(id)).toMatchObject({ resolved: false, resolvedBy: null });
    });

    it('lets anyone with write access resolve a thread', async () => {
      const id = await thread();
      await resolve(writer, id).expect(200);
      expect(await shown(id)).toMatchObject({
        resolved: true,
        resolvedBy: { username: writer.username },
      });
      await unresolve(owner, id).expect(200);
    });

    it('refuses the thread’s own author when they are neither the pull request author nor a writer', async () => {
      const id = await thread(commenter);
      await resolve(commenter, id).expect(403);
      await resolve(writer, id).expect(200);
      await unresolve(commenter, id).expect(403);
      expect(await shown(id)).toMatchObject({ resolved: true });
    });

    it('requires signing in', async () => {
      const id = await thread();
      await api().post(pull(number, `/comments/${id}/resolve`)).expect(401);
    });

    it('refuses a reply, which is not a thread, with 422', async () => {
      const id = await thread();
      const reply = await api()
        .post(pull(number, `/comments/${id}/replies`))
        .set('cookie', author.cookie)
        .send({ body: 'replying' })
        .expect(201);
      await resolve(author, reply.body.id).expect(422);
      await unresolve(author, reply.body.id).expect(422);
    });

    it('answers 404 for a thread on another pull request, or none at all', async () => {
      const elsewhere = await thread(commenter, otherNumber);
      await resolve(author, elsewhere, number).expect(404);
      await resolve(author, 'prrc_missing').expect(404);
    });

    it('records each change in the outbox, once however often it is repeated', async () => {
      const id = await thread();
      await resolve(author, id).expect(200);
      await resolve(author, id).expect(200);
      await unresolve(writer, id).expect(200);
      await unresolve(writer, id).expect(200);

      const [pullRequest] = await db()
        .select({ issueId: schema.pullRequest.issueId })
        .from(schema.pullRequest)
        .innerJoin(schema.issue, eq(schema.issue.id, schema.pullRequest.issueId))
        .where(and(eq(schema.issue.repositoryId, repositoryId), eq(schema.issue.number, number)));
      expect(await outbox('pull_request_review_thread.resolved', id)).toEqual([
        { payload: { issueId: pullRequest.issueId, commentId: id }, actorId: author.userId },
      ]);
      expect(await outbox('pull_request_review_thread.unresolved', id)).toEqual([
        { payload: { issueId: pullRequest.issueId, commentId: id }, actorId: writer.userId },
      ]);
    });

    it('clears who resolved a thread when that account is deleted, and keeps it resolved', async () => {
      const temporary = await account(`rttemp${stamp}`);
      await collaborate(temporary, 'write');
      const id = await thread();
      await resolve(temporary, id).expect(200);
      await db().delete(schema.user).where(eq(schema.user.id, temporary.userId));
      expect(await shown(id)).toMatchObject({ resolved: true, resolvedBy: null });
    });
  });

  describe('GitHub GraphQL', () => {
    it('lists review threads with GitHub’s fields', async () => {
      await thread();
      const text = `thread ${counter}`;
      expect(await threadNode(author, text)).toEqual({
        id: expect.any(String),
        isResolved: false,
        isOutdated: false,
        isCollapsed: false,
        path: 'notes.txt',
        line: 1,
        startLine: null,
        diffSide: 'RIGHT',
        viewerCanResolve: true,
        viewerCanUnresolve: false,
        resolvedBy: null,
        comments: {
          totalCount: 1,
          nodes: [{ body: text, author: { login: commenter.username } }],
        },
      });
    });

    it('resolves and unresolves a thread through the mutations', async () => {
      await thread();
      const text = `thread ${counter}`;
      const { id } = await threadNode(writer, text);

      const resolved = await graphql(
        `mutation($input: ResolveReviewThreadInput!) {
          resolveReviewThread(input: $input) { thread { id isResolved isCollapsed resolvedBy { login } viewerCanResolve viewerCanUnresolve } }
        }`,
        { input: { threadId: id } },
        writer,
      );
      expect(resolved.body.errors).toBeUndefined();
      expect(resolved.body.data.resolveReviewThread.thread).toEqual({
        id,
        isResolved: true,
        isCollapsed: true,
        resolvedBy: { login: writer.username },
        viewerCanResolve: false,
        viewerCanUnresolve: true,
      });
      expect(await threadNode(author, text)).toMatchObject({ isResolved: true });

      const unresolved = await graphql(
        `mutation($input: UnresolveReviewThreadInput!) {
          unresolveReviewThread(input: $input) { thread { isResolved resolvedBy { login } } }
        }`,
        { input: { threadId: id } },
        author,
      );
      expect(unresolved.body.errors).toBeUndefined();
      expect(unresolved.body.data.unresolveReviewThread.thread).toEqual({
        isResolved: false,
        resolvedBy: null,
      });
    });

    it('tells a reader they cannot resolve, and refuses their mutation', async () => {
      await thread();
      const text = `thread ${counter}`;
      const node = await threadNode(commenter, text);
      expect(node).toMatchObject({ viewerCanResolve: false, viewerCanUnresolve: false });

      const refused = await graphql(
        'mutation($input: ResolveReviewThreadInput!) { resolveReviewThread(input: $input) { thread { isResolved } } }',
        { input: { threadId: node.id } },
        commenter,
      );
      expect(refused.body.errors).toHaveLength(1);
      expect(await threadNode(author, text)).toMatchObject({ isResolved: false });
    });

    // Last: moves the head, which outdates every thread.
    it('marks a thread outdated once the head moves on', async () => {
      await thread();
      const text = `thread ${counter}`;
      git('checkout', '-q', 'notes');
      writeFileSync(path.join(work, 'notes.txt'), 'one rewritten\ntwo\n');
      git('commit', '-q', '-am', 'rewrite line one');
      await push('notes');
      expect(await threadNode(author, text)).toMatchObject({ isOutdated: true });
    });
  });
});
