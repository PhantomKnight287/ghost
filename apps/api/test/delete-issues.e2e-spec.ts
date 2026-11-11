import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { type Database, schema } from '@ghost/db';
import { App } from '@octokit/app';
import { Octokit } from '@octokit/core';
import type { INestApplication } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { and, count, eq, isNull } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import {
  generateUserToken,
  hashUserToken,
} from '../src/lib/apps/user-token.js';
import type { Auth } from '../src/lib/auth.js';
import { hasBackends, scopedKey, signUp, startApp } from './harness.js';

type Account = Awaited<ReturnType<typeof signUp>>;

const FORBIDDEN = 'Resource not accessible by integration';

describe.skipIf(!hasBackends)('Deleting an issue', () => {
  let app: INestApplication;
  let db: Database;
  let origin: string;
  let work: string;
  let owner: Account;
  let writer: Account;
  let stranger: Account;
  let orgOwner: Account;
  let appOwner: Account;
  const stamp = Date.now();
  const ownerName = `delowner${stamp}`;
  const writerName = `delwriter${stamp}`;
  const org = `delorg${stamp}`;
  const repo = `del${stamp}`;
  const secret = `delsecret${stamp}`;
  const elsewhere = `delelse${stamp}`;
  const orgRepo = `delorgrepo${stamp}`;
  let repositoryId: string;
  let pullNumber: number;
  let apps = 0;

  const api = () => request(app.getHttpServer());
  const at = (suffix = '', owned = ownerName, name = repo) =>
    `/api/repositories/${owned}/${name}${suffix}`;
  const open = async (
    cookie: string,
    title: string,
    body?: string,
    owned = ownerName,
    name = repo,
  ) => {
    const response = await api()
      .post(at('/issues', owned, name))
      .set('cookie', cookie)
      .send({ title, body });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as { id: string; number: number };
  };
  const remove = (cookie: string | null, number: number, suffix = at()) => {
    const call = api().delete(`${suffix}/issues/${number}`);
    return cookie ? call.set('cookie', cookie) : call;
  };
  const issueRow = async (repository: string, number: number) =>
    (
      await db
        .select()
        .from(schema.issue)
        .where(
          and(
            eq(schema.issue.repositoryId, repository),
            eq(schema.issue.number, number),
          ),
        )
    )[0];
  const repositoryIdOf = async (slug: string) =>
    (
      await db
        .select({ id: schema.repository.id })
        .from(schema.repository)
        .where(eq(schema.repository.slug, slug))
    )[0]!.id;
  const createRepository = (
    cookie: string,
    name: string,
    visibility = 'public',
    organization?: string,
  ) =>
    api()
      .post('/api/repositories')
      .set('cookie', cookie)
      .send({ name, visibility, organization })
      .expect(201);
  const graphql = (credential: string, query: string, variables = {}) =>
    api()
      .post('/api/graphql')
      .set('authorization', `bearer ${credential}`)
      .send({ query, variables })
      .expect(200)
      .then(({ body }) => body);
  const ISSUE_ID = `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issueOrPullRequest(number: $number) { ... on Issue { id } ... on PullRequest { id } } } }`;
  const DELETE = `mutation($id: ID!) { deleteIssue(input: { issueId: $id, clientMutationId: "del-1" }) { clientMutationId repository { nameWithOwner } } }`;
  const nodeIdOf = async (number: number, name = repo) =>
    (
      await graphql(owner.key, ISSUE_ID, {
        owner: ownerName,
        name,
        number,
      })
    ).data.repository.issueOrPullRequest.id as string;
  /** An app with `permissions`, installed on the owner's account, all repositories. */
  const installedApp = async (permissions: Record<string, string>) => {
    const { body } = await api()
      .post('/api/apps')
      .set('cookie', appOwner.cookie)
      .send({
        name: `Delete ${stamp} ${apps++}`,
        homepageUrl: 'https://bot.example',
        permissions,
        events: [],
      })
      .expect(201);
    const { body: key } = await api()
      .post(`/api/apps/${body.slug}/private-keys`)
      .set('cookie', appOwner.cookie)
      .expect(201);
    const { body: installation } = await api()
      .post(`/api/apps/${body.slug}/installations`)
      .set('cookie', owner.cookie)
      .send({ account: ownerName, repositorySelection: 'all' })
      .expect(201);
    const octokitApp = new App({
      appId: body.appId,
      privateKey: key.privateKey,
      Octokit: Octokit.defaults({ baseUrl: `${origin}/api/v3` }),
    });
    const mint = async (narrowing: object = {}) =>
      (
        await octokitApp.octokit.request(
          'POST /app/installations/{installation_id}/access_tokens',
          { installation_id: installation.installationId, ...narrowing },
        )
      ).data.token;
    /** A ghu_ token the OAuth flows would have minted for `userId`. */
    const userToken = async (userId: string) => {
      const token = generateUserToken();
      await db.insert(schema.appUserToken).values({
        appId: body.id,
        userId,
        tokenHash: hashUserToken(token),
      });
      return token;
    };
    return { mint, userToken };
  };
  const git = (cwd: string, ...args: string[]) =>
    promisify(execFile)(
      'git',
      ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
      { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );

  beforeAll(async () => {
    ({ app, origin } = await startApp());
    db = app.get<Database>(DATABASE);
    owner = await signUp(app, ownerName);
    writer = await signUp(app, writerName);
    stranger = await signUp(app, `delstranger${stamp}`);
    orgOwner = await signUp(app, `delorgowner${stamp}`);
    appOwner = await signUp(app, `delappowner${stamp}`);
    await createRepository(owner.cookie, repo);
    await createRepository(owner.cookie, secret, 'private');
    await createRepository(owner.cookie, elsewhere);
    repositoryId = await repositoryIdOf(repo);
    await db.insert(schema.repositoryCollaborator).values({
      repositoryId,
      userId: writer.userId,
      role: 'write',
      acceptedAt: new Date(),
    });
    await app.get<AuthService<Auth>>(AuthService).api.createOrganization({
      body: { name: 'Delete Org', slug: org },
      headers: new Headers({ cookie: orgOwner.cookie }),
    });
    await createRepository(orgOwner.cookie, orgRepo, 'public', org);

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-delete-issues-'));
    execFileSync('git', ['init', '-q', '-b', 'main', work]);
    writeFileSync(path.join(work, 'a.txt'), 'one\n');
    await git(work, 'add', '.');
    await git(work, 'commit', '-q', '-m', 'first');
    for (const branch of ['feature', 'feature2']) {
      await git(work, 'checkout', '-q', '-b', branch, 'main');
      writeFileSync(path.join(work, `${branch}.txt`), `${branch}\n`);
      await git(work, 'add', '.');
      await git(work, 'commit', '-q', '-m', branch);
    }
    await git(
      work,
      'push',
      '-q',
      `${origin.replace('://', `://${ownerName}:${owner.key}@`)}/${ownerName}/${repo}.git`,
      'main',
      'feature',
      'feature2',
    );
    const pull = await api()
      .post(at('/pulls'))
      .set('cookie', owner.cookie)
      .send({ title: 'Feature', base: 'main', head: 'feature' })
      .expect(201);
    pullNumber = pull.body.number;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  describe("Ghost's own API", () => {
    it('lets an admin delete an issue, which is then gone from its URL, the list and search', async () => {
      const title = `Spam ${stamp}`;
      const { number } = await open(writer.cookie, title, 'Buy now');

      const response = await remove(owner.cookie, number);

      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body).toEqual({ deleted: true });
      await api()
        .get(at(`/issues/${number}`))
        .set('cookie', owner.cookie)
        .expect(404);
      const { body: list } = await api()
        .get(at('/issues?state=all&limit=100'))
        .set('cookie', owner.cookie)
        .expect(200);
      expect(
        list.issues.map((issue: { number: number }) => issue.number),
      ).not.toContain(number);
      const { body: found } = await api()
        .get(at(`/issues?state=all&q=${encodeURIComponent(title)}`))
        .set('cookie', owner.cookie)
        .expect(200);
      expect(found.issues).toEqual([]);
    });

    it('takes everything hanging off the issue with it', async () => {
      const { number } = await open(owner.cookie, 'Hangers on');
      const { id: issueId } = (await issueRow(repositoryId, number))!;
      await api()
        .post(at(`/issues/${number}/comments`))
        .set('cookie', writer.cookie)
        .send({ body: 'Me too' })
        .expect(201);
      await api()
        .post(at('/labels'))
        .set('cookie', owner.cookie)
        .send({ name: `doomed-${stamp}`, color: 'ff0000' })
        .expect(201);
      for (const [path, body] of [
        ['labels', { names: [`doomed-${stamp}`] }],
        ['assignees', { usernames: [writerName] }],
      ] as const) {
        const response = await api()
          .put(at(`/issues/${number}/${path}`))
          .set('cookie', owner.cookie)
          .send(body);
        expect(response.status, JSON.stringify(response.body)).toBeLessThan(
          300,
        );
      }

      await remove(owner.cookie, number).expect(200);

      for (const table of [
        schema.issueComment,
        schema.issueLabel,
        schema.issueAssignee,
        schema.issueEvent,
        schema.notification,
        schema.issueSubscription,
      ]) {
        const [{ n }] = await db
          .select({ n: count() })
          .from(table)
          .where(eq(table.issueId, issueId));
        expect(n).toBe(0);
      }
    });

    it("drops the mention from another issue's timeline", async () => {
      const target = await open(owner.cookie, 'Mentioned');
      const mentionTitle = `Mentioner ${stamp}`;
      const mention = await open(
        owner.cookie,
        mentionTitle,
        `See #${target.number}`,
      );
      const timeline = () =>
        api()
          .get(at(`/issues/${target.number}/timeline`))
          .set('cookie', owner.cookie)
          .expect(200)
          .then(({ body }) => JSON.stringify(body));
      expect(await timeline()).toContain(mentionTitle);

      await remove(owner.cookie, mention.number).expect(200);

      expect(await timeline()).not.toContain(mentionTitle);
    });

    it('refuses a write collaborator with 403 and keeps the issue', async () => {
      const { number } = await open(writer.cookie, 'Not yours to delete');

      await remove(writer.cookie, number).expect(403);

      expect(await issueRow(repositoryId, number)).toBeDefined();
    });

    it('refuses an anonymous request with 401', async () => {
      const { number } = await open(owner.cookie, 'Anonymous');

      await remove(null, number).expect(401);

      expect(await issueRow(repositoryId, number)).toBeDefined();
    });

    it('answers 404 to someone who cannot see the private repository', async () => {
      const { number } = await open(
        owner.cookie,
        'Hidden',
        undefined,
        ownerName,
        secret,
      );

      await remove(stranger.cookie, number, at('', ownerName, secret)).expect(
        404,
      );

      expect(
        await issueRow(await repositoryIdOf(secret), number),
      ).toBeDefined();
    });

    it('answers 404 for a pull request number and keeps the pull request', async () => {
      await remove(owner.cookie, pullNumber).expect(404);

      await api()
        .get(at(`/pulls/${pullNumber}`))
        .set('cookie', owner.cookie)
        .expect(200);
    });

    it('answers 404 the second time', async () => {
      const { number } = await open(owner.cookie, 'Twice');

      await remove(owner.cookie, number).expect(200);
      await remove(owner.cookie, number).expect(404);
    });

    it('refuses while the repository is being imported', async () => {
      const elsewhereId = await repositoryIdOf(elsewhere);
      const { number } = await open(
        owner.cookie,
        'Mid import',
        undefined,
        ownerName,
        elsewhere,
      );
      await db.insert(schema.repositoryImport).values({
        repositoryId: elsewhereId,
        requestedById: owner.userId,
        source: 'octo/repo',
        status: 'running',
      });

      try {
        await remove(owner.cookie, number, at('', ownerName, elsewhere)).expect(
          409,
        );
        expect(await issueRow(elsewhereId, number)).toBeDefined();
      } finally {
        await db
          .delete(schema.repositoryImport)
          .where(eq(schema.repositoryImport.repositoryId, elsewhereId));
      }
    });

    it("lets an organization's owner delete in the organization's repository", async () => {
      const { number } = await open(
        orgOwner.cookie,
        'Org issue',
        undefined,
        org,
        orgRepo,
      );

      await remove(orgOwner.cookie, number, at('', org, orgRepo)).expect(200);

      expect(
        await issueRow(await repositoryIdOf(orgRepo), number),
      ).toBeUndefined();
    });

    it('publishes issue.deleted by the deleter, carrying the issue as it was', async () => {
      const { id, number } = await open(writer.cookie, 'Evented', 'Body text');

      await remove(owner.cookie, number).expect(200);

      const events = await db
        .select()
        .from(schema.outboxEvent)
        .where(
          and(
            eq(schema.outboxEvent.repositoryId, repositoryId),
            eq(schema.outboxEvent.type, 'issue.deleted'),
          ),
        );
      const event = events.find(
        (row) => (row.payload as { issue: { id: string } }).issue.id === id,
      );
      expect(event).toBeDefined();
      expect(event!.actorId).toBe(owner.userId);
      expect(event!.payload).toEqual({
        issue: {
          id,
          number,
          title: 'Evented',
          body: 'Body text',
          state: 'open',
          authorId: writer.userId,
        },
      });
    });

    it('notifies nobody', async () => {
      /** Waits until every event of the repository has been handled, so the notifier has had its turn. */
      const settled = async () => {
        for (let i = 0; i < 100; i++) {
          const [{ n }] = await db
            .select({ n: count() })
            .from(schema.outboxEvent)
            .where(
              and(
                eq(schema.outboxEvent.repositoryId, repositoryId),
                isNull(schema.outboxEvent.processedAt),
              ),
            );
          if (n === 0) return;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error('The outbox did not drain');
      };
      const notifications = async () =>
        (
          await db
            .select({ n: count() })
            .from(schema.notification)
            .where(eq(schema.notification.userId, writer.userId))
        )[0]!.n;
      const { id, number } = await open(writer.cookie, 'Quiet');
      await settled();
      const before = await notifications();

      await remove(owner.cookie, number).expect(200);
      await settled();

      const [deleted] = (
        await db
          .select()
          .from(schema.outboxEvent)
          .where(eq(schema.outboxEvent.type, 'issue.deleted'))
      ).filter(
        (row) => (row.payload as { issue: { id: string } }).issue.id === id,
      );
      // processedAt is also set after the last failed attempt; a clean run has no error.
      expect(deleted?.lastError).toBeNull();
      expect(await notifications()).toBe(before);
    });
  });

  describe('numbers', () => {
    it('never gives a deleted newest number out again', async () => {
      const { number } = await open(owner.cookie, 'Newest');

      await remove(owner.cookie, number).expect(200);
      const next = await open(owner.cookie, 'After the newest');

      expect(next.number).toBe(number + 1);
    });

    it('numbers a pull request after a deleted newest issue', async () => {
      const { number } = await open(owner.cookie, 'Newest before a pull');
      await remove(owner.cookie, number).expect(200);

      const { body: pull } = await api()
        .post(at('/pulls'))
        .set('cookie', owner.cookie)
        .send({ title: 'Feature 2', base: 'main', head: 'feature2' })
        .expect(201);

      expect(pull.number).toBe(number + 1);
    });

    it('gives concurrent opens distinct, consecutive numbers', async () => {
      const { number: before } = await open(owner.cookie, 'Before the rush');

      const opened = await Promise.all(
        Array.from({ length: 10 }, (_, i) => open(owner.cookie, `Rush ${i}`)),
      );

      expect(opened.map(({ number }) => number).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 10 }, (_, i) => before + 1 + i),
      );
    });
  });

  describe('GraphQL deleteIssue', () => {
    it('deletes an issue as gh issue delete does', async () => {
      const { number } = await open(owner.cookie, 'Via GraphQL');

      const body = await graphql(owner.key, DELETE, {
        id: await nodeIdOf(number),
      });

      expect(body.errors).toBeUndefined();
      expect(body.data.deleteIssue).toEqual({
        clientMutationId: 'del-1',
        repository: { nameWithOwner: `${ownerName}/${repo}` },
      });
      expect(await issueRow(repositoryId, number)).toBeUndefined();
      const after = await graphql(owner.key, ISSUE_ID, {
        owner: ownerName,
        name: repo,
        number,
      });
      expect(after.errors?.[0]?.type).toBe('NOT_FOUND');
    });

    it("refuses a write collaborator with GitHub's FORBIDDEN wording", async () => {
      const { number } = await open(writer.cookie, 'Collaborator via GraphQL');

      const body = await graphql(writer.key, DELETE, {
        id: await nodeIdOf(number),
      });

      expect(body.errors[0].type).toBe('FORBIDDEN');
      expect(body.errors[0].message).toBe(
        `${writerName} does not have the correct permissions to execute \`DeleteIssue\``,
      );
      expect(await issueRow(repositoryId, number)).toBeDefined();
    });

    it("refuses a pull request's id and keeps the pull request", async () => {
      const body = await graphql(owner.key, DELETE, {
        id: await nodeIdOf(pullNumber),
      });

      expect(body.errors).toBeDefined();
      expect(await issueRow(repositoryId, pullNumber)).toBeDefined();
    });

    it('refuses an OAuth token without a repository write scope', async () => {
      const { number } = await open(owner.cookie, 'Read-only token');
      const readOnly = await scopedKey(app, owner.userId, ['read:org']);

      const body = await graphql(readOnly, DELETE, {
        id: await nodeIdOf(number),
      });

      expect(body.errors).toBeDefined();
      expect(await issueRow(repositoryId, number)).toBeDefined();
    });
  });

  describe('apps', () => {
    let writeApp: Awaited<ReturnType<typeof installedApp>>;
    let readApp: Awaited<ReturnType<typeof installedApp>>;

    beforeAll(async () => {
      writeApp = await installedApp({ issues: 'write', metadata: 'read' });
      readApp = await installedApp({ issues: 'read', metadata: 'read' });
    });

    it('lets an installation token with issues write delete, without an admin role', async () => {
      const { number } = await open(owner.cookie, 'Bot deletes');
      const token = await writeApp.mint();

      const body = await graphql(token, DELETE, { id: await nodeIdOf(number) });

      expect(body.errors).toBeUndefined();
      expect(await issueRow(repositoryId, number)).toBeUndefined();
    });

    it('refuses an installation token with issues read', async () => {
      const { number } = await open(owner.cookie, 'Bot reads');
      const token = await readApp.mint();

      const body = await graphql(token, DELETE, { id: await nodeIdOf(number) });

      expect(body.errors[0].message).toBe(FORBIDDEN);
      expect(await issueRow(repositoryId, number)).toBeDefined();
    });

    it('refuses an installation token narrowed to issues read', async () => {
      const { number } = await open(owner.cookie, 'Narrowed permission');
      const token = await writeApp.mint({ permissions: { issues: 'read' } });

      const body = await graphql(token, DELETE, { id: await nodeIdOf(number) });

      expect(body.errors[0].message).toBe(FORBIDDEN);
      expect(await issueRow(repositoryId, number)).toBeDefined();
    });

    it('refuses an installation token narrowed to another repository', async () => {
      const { number } = await open(owner.cookie, 'Narrowed repository');
      const token = await writeApp.mint({ repositories: [elsewhere] });

      const body = await graphql(token, DELETE, { id: await nodeIdOf(number) });

      expect(body.errors).toBeDefined();
      expect(await issueRow(repositoryId, number)).toBeDefined();
    });

    // Ghost refuses ghu_ tokens on all of GraphQL, and deleteIssue lives only there.
    it("refuses an admin's ghu_ token, as all of GraphQL refuses ghu_ tokens", async () => {
      const { number } = await open(owner.cookie, 'ghu admin');
      const token = await writeApp.userToken(owner.userId);

      const { body } = await api()
        .post('/api/graphql')
        .set('authorization', `token ${token}`)
        .send({ query: DELETE, variables: { id: await nodeIdOf(number) } })
        .expect(403);

      expect(body.message).toBe(FORBIDDEN);
      expect(await issueRow(repositoryId, number)).toBeDefined();
    });
  });
});
