import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { type Database, schema } from '@ghost/db';
import type { INestApplication } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { and, eq, isNull } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import type { Auth } from '../src/lib/auth.js';
import { hasBackends, signUp, startApp } from './harness.js';

type Account = Awaited<ReturnType<typeof signUp>>;

describe.skipIf(!hasBackends)('pull request review requests', () => {
  let app: INestApplication;
  let origin: string;
  let owner: Account;
  let collaborator: Account;
  let bystander: Account;
  let work: string;
  const stamp = Date.now();
  const ownerName = `rrowner${stamp}`;
  const collaboratorName = `rrcollab${stamp}`;
  const bystanderName = `rrbystander${stamp}`;
  const org = `rrorg${stamp}`;
  let repo: string;

  const api = () => request(app.getHttpServer());
  const auth = () => app.get<AuthService<Auth>>(AuthService).api;
  const pull = (suffix = '', at = `${ownerName}/${repo}`) =>
    `/api/repositories/${at}/pulls/1${suffix}`;
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
      { cwd: work, encoding: 'utf8' },
    ).trim();
  // The server runs in this process, so anything that talks to it must not block the event loop.
  const push = (to: string) =>
    promisify(execFile)(
      'git',
      [
        'push',
        '-q',
        `${origin.replace('://', `://${ownerName}:${owner.key}@`)}/${to}.git`,
        'main',
        'feature',
      ],
      { cwd: work, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
  const openPull = (at: string) =>
    api()
      .post(`/api/repositories/${at}/pulls`)
      .set('cookie', owner.cookie)
      .send({ title: 'Feature', base: 'main', head: 'feature' })
      .expect(201);
  const requestReviewers = (body: object, as = owner, at?: string) =>
    api()
      .post(pull('/requested-reviewers', at))
      .set('cookie', as.cookie)
      .send(body);
  const outboxCount = async (type: string) =>
    (
      await app
        .get<Database>(DATABASE)
        .select({ id: schema.outboxEvent.id })
        .from(schema.outboxEvent)
        .where(eq(schema.outboxEvent.type, type))
    ).length;
  const timelineEvents = async (type: string) =>
    (
      await api()
        .get(`/api/repositories/${ownerName}/${repo}/issues/1/timeline`)
        .expect(200)
    ).body.timeline
      .filter(
        (entry: { kind: string; event?: { type: string } }) =>
          entry.kind === 'event' && entry.event?.type === type,
      )
      .map((entry: { event: object }) => entry.event);

  beforeAll(async () => {
    ({ app, origin } = await startApp());
    owner = await signUp(app, ownerName);
    collaborator = await signUp(app, collaboratorName);
    bystander = await signUp(app, bystanderName);

    repo = (
      await api()
        .post('/api/repositories')
        .set('cookie', owner.cookie)
        .send({ name: 'requested', visibility: 'public' })
        .expect(201)
    ).body.slug;
    await api()
      .put(
        `/api/repositories/${ownerName}/${repo}/collaborators/${collaboratorName}`,
      )
      .set('cookie', owner.cookie)
      .send({ role: 'write' })
      .expect(200);
    const invitation = (
      await api()
        .get('/api/invitations')
        .set('cookie', collaborator.cookie)
        .expect(200)
    ).body.invitations[0];
    await api()
      .post(`/api/invitations/${invitation.id}/accept`)
      .set('cookie', collaborator.cookie)
      .expect(204);

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-review-requests-'));
    git('init', '-q', '-b', 'main');
    writeFileSync(path.join(work, 'a.txt'), 'one\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    git('checkout', '-q', '-b', 'feature');
    writeFileSync(path.join(work, 'a.txt'), 'one\ntwo\n');
    git('commit', '-q', '-am', 'second');
    await push(`${ownerName}/${repo}`);
    await openPull(`${ownerName}/${repo}`);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('requests a review from a collaborator once, and records it on the timeline', async () => {
    const { body } = await requestReviewers({
      users: [collaboratorName],
    }).expect(201);
    expect(body.users).toHaveLength(1);
    expect(body.users[0]).toMatchObject({
      username: collaboratorName,
      asCodeOwner: false,
    });
    expect(body.teams).toEqual([]);

    const again = await requestReviewers({ users: [collaboratorName] }).expect(
      201,
    );
    expect(again.body.users).toHaveLength(1);
    const nothing = await requestReviewers({}).expect(201);
    expect(nothing.body.users).toHaveLength(1);
    const listed = await api().get(pull('/requested-reviewers')).expect(200);
    expect(listed.body.users).toHaveLength(1);

    const events = await timelineEvents('review_requested');
    expect(events).toEqual([
      expect.objectContaining({
        actorUsername: ownerName,
        requestedReviewerUsername: collaboratorName,
      }),
    ]);
  });

  it('refuses reviewers without a role, the author, and more than fifteen at once', async () => {
    await requestReviewers({ users: [bystanderName] }).expect(422);
    await requestReviewers({ users: [ownerName] }).expect(422);
    await requestReviewers({ users: [`nobody${stamp}`] }).expect(422);
    // A user's repository has no teams to request.
    await requestReviewers({ teams: ['core'] }).expect(422);
    const tooMany = await requestReviewers({
      users: Array.from({ length: 16 }, (_, i) => `user${i}${stamp}`),
    }).expect(422);
    expect(tooMany.body.message).toBe(
      'At most 15 reviewers can be requested at once',
    );
  });

  it('offers people with a role of their own, other than the author, filtered by `q`', async () => {
    const requestable = async (q = '') =>
      (
        await api()
          .get(pull('/requestable-reviewers'))
          .query({ q })
          .set('cookie', bystander.cookie)
          .expect(200)
      ).body;
    const everyone = await requestable();
    expect(
      everyone.users.map((user: { username: string }) => user.username),
    ).toEqual([collaboratorName]);
    expect(everyone.teams).toEqual([]);
    expect(
      (await requestable(collaboratorName.slice(0, 6))).users,
    ).toHaveLength(1);
    expect((await requestable(`nobody${stamp}`)).users).toEqual([]);
  });

  it('lets only triage and above request reviews', async () => {
    const { status } = await requestReviewers(
      { users: [collaboratorName] },
      bystander,
    );
    expect([403, 404]).toContain(status);
  });

  it('removes a request, and requests again with a new row', async () => {
    const { body } = await api()
      .delete(pull('/requested-reviewers'))
      .set('cookie', owner.cookie)
      .send({ users: [collaboratorName] })
      .expect(200);
    expect(body.users).toEqual([]);
    expect(
      (await api().get(pull('/requested-reviewers')).expect(200)).body.users,
    ).toEqual([]);
    expect(await timelineEvents('review_request_removed')).toEqual([
      expect.objectContaining({ requestedReviewerUsername: collaboratorName }),
    ]);

    const again = await requestReviewers({ users: [collaboratorName] }).expect(
      201,
    );
    expect(again.body.users).toHaveLength(1);
    const rows = await app
      .get<Database>(DATABASE)
      .select()
      .from(schema.pullRequestReviewRequest)
      .where(
        and(
          eq(
            schema.pullRequestReviewRequest.reviewerUserId,
            collaborator.userId,
          ),
        ),
      );
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.clearedAt === null)).toHaveLength(1);
    expect(rows.find((row) => row.clearedAt !== null)?.clearedReason).toBe(
      'removed',
    );
  });

  it('requests a team that has access to an organization repository by slug', async () => {
    const { id: organizationId } = (await auth().createOrganization({
      body: { name: 'Review Org', slug: org },
      headers: new Headers({ cookie: owner.cookie }),
    }))!;
    await api()
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: 'widget', organization: org, visibility: 'private' })
      .expect(201);
    await push(`${org}/widget`);
    await openPull(`${org}/widget`);

    const core = await auth().createTeam({
      body: { name: 'Core', organizationId },
      headers: new Headers({ cookie: owner.cookie }),
    });
    await auth().createTeam({
      body: { name: 'Outsiders', organizationId },
      headers: new Headers({ cookie: owner.cookie }),
    });
    await api()
      .put(`/api/repositories/${org}/widget/teams/${core!.id}`)
      .set('cookie', owner.cookie)
      .send({ role: 'read' })
      .expect(204);

    const { body } = await requestReviewers(
      { teams: ['core'] },
      owner,
      `${org}/widget`,
    ).expect(201);
    expect(body.teams).toEqual([
      expect.objectContaining({
        slug: 'core',
        name: 'Core',
        asCodeOwner: false,
      }),
    ]);
    await requestReviewers(
      { teams: ['outsiders'] },
      owner,
      `${org}/widget`,
    ).expect(422);
    await requestReviewers(
      { teams: ['nonexistent'] },
      owner,
      `${org}/widget`,
    ).expect(422);
  });

  it('offers only the teams an organization repository is shared with', async () => {
    const { body } = await api()
      .get(pull('/requestable-reviewers', `${org}/widget`))
      .set('cookie', owner.cookie)
      .expect(200);
    expect(body.teams).toEqual([
      { id: expect.any(String), slug: 'core', name: 'Core' },
    ]);
  });

  it('leaves a request pending while the review is unsubmitted', async () => {
    const db = app.get<Database>(DATABASE);
    const [request] = await db
      .select({ pullRequestId: schema.pullRequestReviewRequest.pullRequestId })
      .from(schema.pullRequestReviewRequest)
      .where(
        and(
          eq(
            schema.pullRequestReviewRequest.reviewerUserId,
            collaborator.userId,
          ),
          isNull(schema.pullRequestReviewRequest.clearedAt),
        ),
      );
    const [pending] = await db
      .insert(schema.pullRequestReview)
      .values({
        pullRequestId: request!.pullRequestId,
        authorId: collaborator.userId,
        commitSha: git('rev-parse', 'HEAD'),
      })
      .returning({ id: schema.pullRequestReview.id });
    expect(
      (await api().get(pull('/requested-reviewers'))).body.users,
    ).toHaveLength(1);
    await db
      .delete(schema.pullRequestReview)
      .where(eq(schema.pullRequestReview.id, pending!.id));
  });

  it('answers a user request when the review is submitted, and a re-request is new', async () => {
    const db = app.get<Database>(DATABASE);
    const removedBefore = await outboxCount(
      'pull_request.review_request_removed',
    );
    await api()
      .post(pull('/reviews'))
      .set('cookie', collaborator.cookie)
      .send({ state: 'commented', body: 'Looking' })
      .expect(201);
    expect(
      (await api().get(pull('/requested-reviewers')).expect(200)).body.users,
    ).toEqual([]);

    const rows = await db
      .select()
      .from(schema.pullRequestReviewRequest)
      .where(
        eq(schema.pullRequestReviewRequest.reviewerUserId, collaborator.userId),
      );
    expect(rows.filter((row) => row.clearedReason === 'reviewed')).toHaveLength(
      1,
    );
    expect(await outboxCount('pull_request.review_request_removed')).toBe(
      removedBefore,
    );

    await requestReviewers({ users: [collaboratorName] }).expect(201);
    const after = await db
      .select()
      .from(schema.pullRequestReviewRequest)
      .where(
        and(
          eq(
            schema.pullRequestReviewRequest.reviewerUserId,
            collaborator.userId,
          ),
          isNull(schema.pullRequestReviewRequest.clearedAt),
        ),
      );
    expect(after).toHaveLength(1);
  });

  it('answers every requested team the reviewer belongs to', async () => {
    const db = app.get<Database>(DATABASE);
    const at = `${org}/widget`;
    const { id: organizationId } = (
      await db
        .select({ id: schema.organization.id })
        .from(schema.organization)
        .where(eq(schema.organization.slug, org))
    )[0]!;
    await auth().addMember({
      body: { userId: collaborator.userId, role: 'member', organizationId },
    });
    const teams = [];
    for (const name of ['Docs', 'Platform']) {
      const created = (await auth().createTeam({
        body: { name, organizationId },
        headers: new Headers({ cookie: owner.cookie }),
      }))!;
      await auth().addTeamMember({
        body: {
          teamId: created.id,
          userId: collaborator.userId,
          organizationId,
        },
        headers: new Headers({ cookie: owner.cookie }),
      });
      await api()
        .put(`/api/repositories/${at}/teams/${created.id}`)
        .set('cookie', owner.cookie)
        .send({ role: 'write' })
        .expect(204);
      teams.push(created.id);
    }
    await requestReviewers({ teams: ['docs', 'platform'] }, owner, at).expect(
      201,
    );

    const { body: review } = await api()
      .post(pull('/reviews', at))
      .set('cookie', collaborator.cookie)
      .send({ state: 'approved' })
      .expect(201);
    expect(
      (
        await api()
          .get(pull('/requested-reviewers', at))
          .set('cookie', owner.cookie)
          .expect(200)
      ).body.teams.map((team: { slug: string }) => team.slug),
    ).toEqual(['core']);
    const onBehalf = await db
      .select({ teamId: schema.pullRequestReviewOnBehalfOf.teamId })
      .from(schema.pullRequestReviewOnBehalfOf)
      .innerJoin(
        schema.pullRequestReview,
        eq(
          schema.pullRequestReview.id,
          schema.pullRequestReviewOnBehalfOf.reviewId,
        ),
      )
      .where(eq(schema.pullRequestReview.id, review.id));
    expect(onBehalf.map((row) => row.teamId).sort()).toEqual([...teams].sort());
  });

  it('refuses requests on a closed pull request', async () => {
    await api().patch(pull('/close')).set('cookie', owner.cookie).expect(200);
    await api()
      .delete(pull('/requested-reviewers'))
      .set('cookie', owner.cookie)
      .send({ users: [collaboratorName] })
      .expect(200);
    // PullRequestNotOpenError, shared with merging a closed request, answers 409.
    await requestReviewers({ users: [collaboratorName] }).expect(409);
  });
});
