import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { type Database, schema } from '@ghost/db';
import type { INestApplication } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { and, eq, isNull, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import type { Auth } from '../src/lib/auth.js';
import { hasBackends, signUp, startApp } from './harness.js';

type Account = Awaited<ReturnType<typeof signUp>> & { username: string };
type Violation = {
  ref: string;
  rulesetId: string;
  rulesetName: string;
  rule: string;
  requirement?: string;
  message: string;
};
type Requirements = {
  violations: Violation[];
  bypassed: Violation[];
  allowedMethods: string[];
};

const ALL_METHODS = ['merge', 'squash', 'rebase'];
const NO_REQUIREMENTS = {
  required_approving_review_count: 0,
  dismiss_stale_reviews_on_push: false,
  require_code_owner_review: false,
  require_last_push_approval: false,
  required_review_thread_resolution: false,
  allowed_merge_methods: ALL_METHODS,
};

/** The pull_request rule against real reviews, threads, CODEOWNERS and pushes: the facts PullRequestRulesService gathers, the stale-approval consumer, and merge blocking with its bypass flag. Each case gets its own base branch, so rulesets never reach across cases. Cases push and wait on the outbox, past vitest's 5 second default. */
describe.skipIf(!hasBackends)('pull request rules', { timeout: 30_000 }, () => {
  let app: INestApplication;
  let origin: string;
  let owner: Account;
  let author: Account;
  let reviewer: Account;
  let second: Account;
  let reader: Account;
  let teammate: Account;
  let maintainer: Account;
  let work: string;
  let repositoryId: string;
  const stamp = Date.now();
  const org = `prrorg${stamp}`;
  const repo = `${org}/reviewed`;
  let counter = 0;
  let accounts = 0;

  const api = () => request(app.getHttpServer());
  const db = () => app.get<Database>(DATABASE);
  const auth = () => app.get<AuthService<Auth>>(AuthService).api;
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
      { cwd: work, encoding: 'utf8' },
    ).trim();
  const remote = (who: Account) =>
    `${origin.replace('://', `://${who.username}:${who.key}@`)}/${repo}.git`;
  // The server runs in this process, so anything that talks to it must not block the event loop.
  const pushAs = (who: Account, ...refspecs: string[]) =>
    promisify(execFile)('git', ['push', '-q', remote(who), ...refspecs], {
      cwd: work,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  const serverTip = async (ref: string) => {
    const { stdout } = await promisify(execFile)(
      'git',
      ['ls-remote', remote(owner), ref],
      { cwd: work, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
    return stdout.split('\t')[0] || null;
  };
  /** Checks out `branch` at `from`, writes `files` (an empty string deletes one) and commits; returns the new sha. */
  const commitOn = (
    branch: string,
    from: string,
    files: Record<string, string> = { [`work/${++counter}.txt`]: `${counter}\n` },
  ) => {
    git('checkout', '-q', '-B', branch, from);
    for (const [file, text] of Object.entries(files)) {
      const full = path.join(work, file);
      if (text === '') {
        rmSync(full, { force: true });
        continue;
      }
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, text);
    }
    git('add', '-A');
    git('commit', '-q', '-m', `commit ${++counter} on ${branch}`);
    return git('rev-parse', 'HEAD');
  };
  const account = async (prefix: string): Promise<Account> => {
    const username = `${prefix}${++accounts}x${stamp}`;
    return { ...(await signUp(app, username)), username };
  };
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
  const pull = (number: number, suffix = '') =>
    `/api/repositories/${repo}/pulls/${number}${suffix}`;

  /** A fresh base branch off main, and an open pull request into it from `author`, whose head changes `files`. */
  const pullRequest = async (
    files: Record<string, string> = { 'work/change.txt': `${++counter}\n` },
  ) => {
    const base = `base-${++counter}`;
    git('checkout', '-q', '-B', base, 'main');
    await pushAs(owner, `${base}:refs/heads/${base}`);
    const head = `${base}-head`;
    commitOn(head, base, files);
    await pushAs(author, `${head}:refs/heads/${head}`);
    const number = (
      await api()
        .post(`/api/repositories/${repo}/pulls`)
        .set('cookie', author.cookie)
        .send({ title: head, base, head })
        .expect(201)
    ).body.number as number;
    return { base, head, number };
  };
  const ruleset = async (body: object) =>
    (
      await api()
        .post(`/api/repositories/${repo}/rulesets`)
        .set('cookie', owner.cookie)
        .send({
          target: 'branch',
          enforcement: 'active',
          exclude: [],
          bypassActors: [],
          ...body,
        })
        .expect(201)
    ).body;
  /** A ruleset on `base` with one pull_request rule. */
  const requireOn = (
    base: string,
    parameters: Partial<typeof NO_REQUIREMENTS>,
    extra: object = {},
  ) =>
    ruleset({
      name: `${base} ${Object.keys(parameters).join(' ')} ${++counter}`,
      include: [base],
      rules: [
        { type: 'pull_request', parameters: { ...NO_REQUIREMENTS, ...parameters } },
      ],
      ...extra,
    });
  const requirements = async (
    number: number,
    viewer: Account = author,
    method = 'squash',
  ) =>
    (
      await api()
        .get(pull(number, '/merge-requirements'))
        .query({ method })
        .set('cookie', viewer.cookie)
        .expect(200)
    ).body as Requirements;
  /** The requirements still unmet for `viewer`, by name. */
  const unmet = async (number: number, viewer: Account = author) =>
    (await requirements(number, viewer)).violations
      .map(({ requirement }) => requirement)
      .sort();
  const review = (who: Account, number: number, state: string, body?: string) =>
    api()
      .post(pull(number, '/reviews'))
      .set('cookie', who.cookie)
      .send({ state, body })
      .expect(201);
  const approve = (who: Account, number: number) => review(who, number, 'approved');
  const lineComment = async (who: Account, number: number, file: string) =>
    (
      await api()
        .post(pull(number, '/reviews'))
        .set('cookie', who.cookie)
        .send({
          state: 'commented',
          comments: [{ path: file, side: 'additions', line: 1, body: 'Why?' }],
        })
        .expect(201)
    ).body.comments[0].id as string;
  const merge = (who: Account, number: number, extra: object = {}) =>
    api()
      .post(pull(number, '/merge'))
      .set('cookie', who.cookie)
      .send({ method: 'squash', ...extra });
  const rowOf = async (number: number) => {
    const [row] = await db()
      .select({
        id: schema.pullRequest.id,
        issueId: schema.pullRequest.issueId,
        headPushedById: schema.pullRequest.headPushedById,
      })
      .from(schema.pullRequest)
      .innerJoin(schema.issue, eq(schema.issue.id, schema.pullRequest.issueId))
      .where(
        and(
          eq(schema.issue.repositoryId, repositoryId),
          eq(schema.issue.number, number),
        ),
      );
    return row!;
  };
  const reviewRow = async (reviewId: string) => {
    const [row] = await db()
      .select({
        dismissedById: schema.pullRequestReview.dismissedById,
        dismissalMessage: schema.pullRequestReview.dismissalMessage,
        baseSha: schema.pullRequestReview.baseSha,
      })
      .from(schema.pullRequestReview)
      .where(eq(schema.pullRequestReview.id, reviewId));
    return row!;
  };
  // The server records a push to a pull request after answering it.
  const synchronized = (after: string) =>
    vi.waitFor(
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
  // Consumers run off the outbox, after the change that triggered them has committed.
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
  const timelineEvents = async (number: number, type: string) =>
    (
      await api()
        .get(`/api/repositories/${repo}/issues/${number}/timeline`)
        .set('cookie', owner.cookie)
        .expect(200)
    ).body.timeline
      .filter(
        (item: { kind: string; event?: { type: string } }) =>
          item.kind === 'event' && item.event?.type === type,
      )
      .map((item: { event: object }) => item.event);

  beforeAll(async () => {
    ({ app, origin } = await startApp());
    owner = await account('prrowner');
    author = await account('prrauthor');
    reviewer = await account('prrreviewer');
    second = await account('prrsecond');
    reader = await account('prrreader');
    teammate = await account('prrteam');
    maintainer = await account('prrmaint');
    const headers = new Headers({ cookie: owner.cookie });
    const { id: organizationId } = (await auth().createOrganization({
      body: { name: 'Pull request rules', slug: org },
      headers,
    }))!;
    await auth().addMember({
      body: { userId: teammate.userId, role: 'member', organizationId },
    });
    const teamId = (await auth().createTeam({
      body: { name: 'Core', organizationId },
      headers,
    }))!.id;
    await auth().addTeamMember({
      body: { teamId, userId: teammate.userId, organizationId },
      headers,
    });
    repositoryId = (
      await api()
        .post('/api/repositories')
        .set('cookie', owner.cookie)
        .send({ name: 'reviewed', organization: org, visibility: 'public' })
        .expect(201)
    ).body.id;
    await api()
      .put(`/api/repositories/${repo}/teams/${teamId}`)
      .set('cookie', owner.cookie)
      .send({ role: 'write' })
      .expect(204);
    await collaborate(author, 'write');
    await collaborate(reviewer, 'write');
    await collaborate(second, 'write');
    await collaborate(maintainer, 'maintain');

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-pull-request-rules-'));
    git('init', '-q', '-b', 'main');
    mkdirSync(path.join(work, 'owned'));
    mkdirSync(path.join(work, 'team'));
    writeFileSync(
      path.join(work, 'CODEOWNERS'),
      `/owned/ @${reviewer.username}\n/team/ @${org}/core\n`,
    );
    writeFileSync(path.join(work, 'owned', 'a.txt'), 'a\n');
    writeFileSync(path.join(work, 'team', 'a.txt'), 'a\n');
    writeFileSync(path.join(work, 'notes.txt'), 'notes\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    await pushAs(owner, 'main');
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  describe('facts', () => {
    it('no pull_request rule: no requirements, every merge method', async () => {
      const { base, number } = await pullRequest();
      await ruleset({ name: `${base} deletion`, include: [base], rules: [{ type: 'deletion' }] });

      const answer = await requirements(number);
      expect(answer.violations).toEqual([]);
      expect(answer.bypassed).toEqual([]);
      expect([...answer.allowedMethods].sort()).toEqual([...ALL_METHODS].sort());
    });

    it('names the ruleset, the ref and the requirement on each violation', async () => {
      const { base, number } = await pullRequest();
      const made = await requireOn(base, { required_approving_review_count: 1 });

      expect((await requirements(number)).violations).toEqual([
        {
          ref: `refs/heads/${base}`,
          rulesetId: made.id,
          rulesetName: made.name,
          rule: 'pull_request',
          requirement: 'approvals',
          message: expect.any(String),
        },
      ]);
    });

    it('counts an approval from a write collaborator, not from a reader', async () => {
      const { base, number } = await pullRequest();
      await requireOn(base, { required_approving_review_count: 1 });
      expect(await unmet(number)).toEqual(['approvals']);

      await approve(reader, number);
      expect(await unmet(number)).toEqual(['approvals']);

      await approve(reviewer, number);
      expect(await unmet(number)).toEqual([]);
    });

    it('drops an approval whose reviewer lost write access', async () => {
      const leaving = await account('prrleaving');
      await collaborate(leaving, 'write');
      const { base, number } = await pullRequest();
      await requireOn(base, { required_approving_review_count: 1 });
      await approve(leaving, number);
      expect(await unmet(number)).toEqual([]);

      await api()
        .delete(`/api/repositories/${repo}/collaborators/${leaving.username}`)
        .set('cookie', owner.cookie)
        .expect(204);
      expect(await unmet(number)).toEqual(['approvals']);
    });

    it('latest verdict wins: an approval after a change request unblocks, and so does dismissing the change request', async () => {
      const { base, number } = await pullRequest();
      await requireOn(base, { required_approving_review_count: 1 });

      await review(reviewer, number, 'changes_requested', 'Please fix');
      expect(await unmet(number)).toEqual(['approvals', 'changes_requested']);
      await approve(reviewer, number);
      expect(await unmet(number)).toEqual([]);

      const blocking = await review(second, number, 'changes_requested', 'Not yet');
      expect(await unmet(number)).toEqual(['changes_requested']);
      await api()
        .post(pull(number, `/reviews/${blocking.body.id}/dismiss`))
        .set('cookie', owner.cookie)
        .send({ message: 'Overruled' })
        .expect(201);
      expect(await unmet(number)).toEqual([]);
    });

    it('ignores a change request from a reader', async () => {
      const { base, number } = await pullRequest();
      await requireOn(base, { required_approving_review_count: 1 });
      await approve(reviewer, number);
      await review(reader, number, 'changes_requested', 'Drive-by');
      expect(await unmet(number)).toEqual([]);
    });

    it('records the base tip on a submitted review', async () => {
      const { base, number } = await pullRequest();
      const approval = await approve(reviewer, number);
      expect((await reviewRow(approval.body.id)).baseSha).toBe(
        await serverTip(`refs/heads/${base}`),
      );
    });

    it('new head commit makes approval stale', async () => {
      const { base, head, number } = await pullRequest();
      await requireOn(base, {
        required_approving_review_count: 1,
        dismiss_stale_reviews_on_push: true,
      });
      await approve(reviewer, number);
      expect(await unmet(number)).toEqual([]);

      commitOn(head, head);
      await pushAs(author, `${head}:refs/heads/${head}`);
      expect(await unmet(number)).toEqual(['approvals']);
    });

    it('conflict-free rebase keeps approval: a new head with the same diff', async () => {
      const { base, head, number } = await pullRequest();
      await requireOn(base, {
        required_approving_review_count: 1,
        dismiss_stale_reviews_on_push: true,
      });
      const approval = await approve(reviewer, number);

      git('checkout', '-q', head);
      git('commit', '-q', '--amend', '-m', 'same change, new message');
      const after = git('rev-parse', 'HEAD');
      await pushAs(author, `+${head}:refs/heads/${head}`);
      expect(await unmet(number)).toEqual([]);

      await synchronized(after);
      await settle();
      expect((await reviewRow(approval.body.id)).dismissalMessage).toBeNull();
      expect(await unmet(number)).toEqual([]);
    });

    it('base move makes approval stale, even when the base commits touch other files', async () => {
      const { base, number } = await pullRequest({ 'work/mine.txt': 'mine\n' });
      await approve(reviewer, number);
      commitOn(base, base, { 'elsewhere.txt': 'unrelated\n' });
      await pushAs(owner, `${base}:refs/heads/${base}`);
      await requireOn(base, {
        required_approving_review_count: 1,
        dismiss_stale_reviews_on_push: true,
      });
      expect(await unmet(number)).toEqual(['approvals']);

      await approve(reviewer, number);
      expect(await unmet(number)).toEqual([]);
    });

    it('pre-migration review (null base_sha) is not stale from the base side', async () => {
      const { base, number } = await pullRequest();
      const approval = await approve(reviewer, number);
      await db()
        .update(schema.pullRequestReview)
        .set({ baseSha: null })
        .where(eq(schema.pullRequestReview.id, approval.body.id));
      commitOn(base, base, { 'elsewhere.txt': `moved ${counter}\n` });
      await pushAs(owner, `${base}:refs/heads/${base}`);
      await requireOn(base, {
        required_approving_review_count: 1,
        dismiss_stale_reviews_on_push: true,
      });
      expect(await unmet(number)).toEqual([]);
    });

    it('code owner from base CODEOWNERS, not head: dropping the owner in the pull request changes nothing', async () => {
      const { base, number } = await pullRequest({
        'owned/b.txt': 'b\n',
        CODEOWNERS: `/owned/ @${second.username}\n`,
      });
      await requireOn(base, { require_code_owner_review: true });

      const [waiting] = (await requirements(number)).violations;
      expect(waiting).toMatchObject({ requirement: 'code_owners' });
      expect(waiting.message).toContain(`@${reviewer.username}`);

      await approve(second, number);
      expect(await unmet(number)).toEqual(['code_owners']);
      await approve(reviewer, number);
      expect(await unmet(number)).toEqual([]);
    });

    it("team code owner satisfied by a team member's approval", async () => {
      const { base, number } = await pullRequest({ 'team/b.txt': 'b\n' });
      await requireOn(base, { require_code_owner_review: true });

      const [waiting] = (await requirements(number)).violations;
      expect(waiting).toMatchObject({ requirement: 'code_owners' });
      expect(waiting.message).toContain(`@${org}/core`);

      await approve(reviewer, number);
      expect(await unmet(number)).toEqual(['code_owners']);
      await approve(teammate, number);
      expect(await unmet(number)).toEqual([]);
    });

    it('needs no code owner review for files nobody owns', async () => {
      const { base, number } = await pullRequest({ 'free/b.txt': 'b\n' });
      await requireOn(base, { require_code_owner_review: true });
      expect(await unmet(number)).toEqual([]);
    });

    it('blocks a code owner’s own pull request when they are its only owner', async () => {
      const base = `base-${++counter}`;
      git('checkout', '-q', '-B', base, 'main');
      await pushAs(owner, `${base}:refs/heads/${base}`);
      const head = `${base}-head`;
      commitOn(head, base, { 'owned/mine.txt': 'mine\n' });
      await pushAs(reviewer, `${head}:refs/heads/${head}`);
      const number = (
        await api()
          .post(`/api/repositories/${repo}/pulls`)
          .set('cookie', reviewer.cookie)
          .send({ title: head, base, head })
          .expect(201)
      ).body.number as number;
      await requireOn(base, { require_code_owner_review: true });

      await approve(second, number);
      expect(await unmet(number, reviewer)).toEqual(['code_owners']);
    });

    it('headPushedById follows git push and suggestion apply', async () => {
      const { head, number } = await pullRequest({ 'notes.txt': 'notes\nmore\n' });
      await vi.waitFor(
        async () => expect((await rowOf(number)).headPushedById).toBe(author.userId),
        { timeout: 15_000, interval: 100 },
      );

      commitOn(head, head);
      await pushAs(second, `${head}:refs/heads/${head}`);
      await vi.waitFor(
        async () => expect((await rowOf(number)).headPushedById).toBe(second.userId),
        { timeout: 15_000, interval: 100 },
      );

      const { body } = await api()
        .post(pull(number, '/reviews'))
        .set('cookie', reviewer.cookie)
        .send({
          state: 'commented',
          comments: [
            {
              path: 'notes.txt',
              side: 'additions',
              line: 2,
              body: '```suggestion\nMORE\n```',
            },
          ],
        })
        .expect(201);
      await api()
        .post(pull(number, `/comments/${body.comments[0].id}/apply`))
        .set('cookie', owner.cookie)
        .expect(201);
      expect((await rowOf(number)).headPushedById).toBe(owner.userId);
    });

    it('last push approval: someone other than the last pusher must approve the current head', async () => {
      const { base, head, number } = await pullRequest();
      await requireOn(base, { require_last_push_approval: true });
      expect(await unmet(number)).toEqual(['last_push']);

      // The author pushed last, so anyone else's approval counts.
      await approve(reviewer, number);
      expect(await unmet(number)).toEqual([]);

      commitOn(head, head);
      await pushAs(second, `${head}:refs/heads/${head}`);
      await vi.waitFor(
        async () => expect((await rowOf(number)).headPushedById).toBe(second.userId),
        { timeout: 15_000, interval: 100 },
      );
      // The earlier approval predates the push, and the pusher cannot approve their own push.
      expect(await unmet(number)).toEqual(['last_push']);
      await approve(second, number);
      expect(await unmet(number)).toEqual(['last_push']);

      await approve(reviewer, number);
      expect(await unmet(number)).toEqual([]);
    });

    it('unresolved thread counts; resolving clears it', async () => {
      const { base, number } = await pullRequest({ 'work/threaded.txt': 'x\n' });
      await requireOn(base, { required_review_thread_resolution: true });
      expect(await unmet(number)).toEqual([]);

      const thread = await lineComment(reviewer, number, 'work/threaded.txt');
      expect(await unmet(number)).toEqual(['threads']);

      await api()
        .post(pull(number, `/comments/${thread}/resolve`))
        .set('cookie', author.cookie)
        .expect(200);
      expect(await unmet(number)).toEqual([]);
    });

    it('reports a merge method the rulesets do not allow, and offers only the allowed ones', async () => {
      const { base, number } = await pullRequest();
      await requireOn(base, { allowed_merge_methods: ['squash', 'rebase'] });
      await requireOn(base, { allowed_merge_methods: ['rebase', 'merge'] });

      expect((await requirements(number, author, 'rebase')).allowedMethods).toEqual(['rebase']);
      expect(await unmet(number)).toEqual(['merge_method']);
      const asMerge = await requirements(number, author, 'merge');
      expect(asMerge.violations.map(({ requirement }) => requirement)).toEqual(['merge_method']);
    });
  });

  describe('stale approval consumer', () => {
    it('dismisses a stale approval with null dismissedById and emits review_dismissed', async () => {
      const { base, head, number } = await pullRequest();
      await requireOn(base, {
        required_approving_review_count: 1,
        dismiss_stale_reviews_on_push: true,
      });
      const approval = await approve(reviewer, number);

      const after = commitOn(head, head);
      await pushAs(author, `${head}:refs/heads/${head}`);
      await synchronized(after);
      await settle();

      expect(await reviewRow(approval.body.id)).toMatchObject({
        dismissedById: null,
        dismissalMessage: expect.any(String),
      });
      const events = await db()
        .select({ payload: schema.outboxEvent.payload })
        .from(schema.outboxEvent)
        .where(
          and(
            eq(schema.outboxEvent.type, 'pull_request.review_dismissed'),
            eq(sql`${schema.outboxEvent.payload}->>'reviewId'`, approval.body.id),
          ),
        );
      expect(events).toEqual([
        { payload: { issueId: (await rowOf(number)).issueId, reviewId: approval.body.id } },
      ]);
      const { body } = await api()
        .get(`/api/repositories/${repo}/issues/${number}/timeline`)
        .expect(200);
      const shown = body.timeline.find(
        (item: { kind: string; id?: string }) =>
          item.kind === 'review' && item.id === approval.body.id,
      );
      expect(shown).toMatchObject({
        dismissedByUsername: null,
        dismissalMessage: expect.any(String),
      });
    });

    it('dismisses approvals on every open pull request into a base that moved', async () => {
      const { base, number } = await pullRequest();
      await requireOn(
        base,
        { required_approving_review_count: 1, dismiss_stale_reviews_on_push: true },
        {
          bypassActors: [
            { actorType: 'RepositoryRole', role: 'maintain', bypassMode: 'always' },
          ],
        },
      );
      const approval = await approve(reviewer, number);

      commitOn(base, base, { 'elsewhere.txt': `base moves ${counter}\n` });
      await pushAs(maintainer, `${base}:refs/heads/${base}`);
      await vi.waitFor(
        async () =>
          expect((await reviewRow(approval.body.id)).dismissalMessage).not.toBeNull(),
        { timeout: 15_000, interval: 100 },
      );
      expect((await reviewRow(approval.body.id)).dismissedById).toBeNull();
    });

    it('does nothing when dismiss_stale is off, and the old approval still counts', async () => {
      const { base, head, number } = await pullRequest();
      await requireOn(base, { required_approving_review_count: 1 });
      const approval = await approve(reviewer, number);

      const after = commitOn(head, head);
      await pushAs(author, `${head}:refs/heads/${head}`);
      await synchronized(after);
      await settle();

      expect((await reviewRow(approval.body.id)).dismissalMessage).toBeNull();
      expect(await unmet(number)).toEqual([]);
    });
  });

  describe('merging', () => {
    it('refuses with 422 listing every unmet requirement, each naming its ruleset', async () => {
      const { base, number } = await pullRequest({ 'owned/listed.txt': 'x\n' });
      const approvals = await requireOn(base, { required_approving_review_count: 1 });
      const owners = await requireOn(base, { require_code_owner_review: true });
      const threads = await requireOn(base, { required_review_thread_resolution: true });
      await lineComment(second, number, 'owned/listed.txt');
      const before = await serverTip(`refs/heads/${base}`);

      const listed = (await requirements(number, owner)).violations;
      expect(
        listed.map(({ requirement, rulesetName }) => [requirement, rulesetName]).sort(),
      ).toEqual(
        [
          ['approvals', approvals.name],
          ['code_owners', owners.name],
          ['threads', threads.name],
        ].sort(),
      );

      const refused = await merge(owner, number).expect(422);
      for (const made of [approvals, owners, threads]) {
        expect(refused.body.message).toContain(made.name);
      }
      expect(await serverTip(`refs/heads/${base}`)).toBe(before);
    });

    it('merges once the requirements are met', async () => {
      const { base, number } = await pullRequest();
      await requireOn(base, { required_approving_review_count: 1 });
      await merge(author, number).expect(422);

      await approve(reviewer, number);
      await merge(author, number).expect(201);
      expect((await api().get(pull(number)).expect(200)).body.state).toBe('merged');
    });

    it('asks a bypasser to opt in, then merges with bypassRules and records the bypass', async () => {
      const { base, number } = await pullRequest();
      const made = await requireOn(
        base,
        { required_approving_review_count: 1 },
        {
          bypassActors: [
            { actorType: 'RepositoryRole', role: 'maintain', bypassMode: 'always' },
          ],
        },
      );
      const before = await serverTip(`refs/heads/${base}`);

      const asked = await merge(maintainer, number).expect(422);
      expect(asked.body.message).toMatch(/bypass/i);
      expect(await serverTip(`refs/heads/${base}`)).toBe(before);

      await merge(maintainer, number, { bypassRules: true }).expect(201);
      expect(await serverTip(`refs/heads/${base}`)).not.toBe(before);

      const [event] = await timelineEvents(number, 'rules_bypassed');
      expect(event).toMatchObject({ actorUsername: maintainer.username });
      expect(JSON.stringify(event)).toContain(made.name);
      const recorded = await db()
        .select({ actorId: schema.outboxEvent.actorId })
        .from(schema.outboxEvent)
        .where(
          and(
            eq(schema.outboxEvent.repositoryId, repositoryId),
            eq(schema.outboxEvent.type, 'pull_request.rules_bypassed'),
            eq(sql`${schema.outboxEvent.payload}->>'issueId'`, (await rowOf(number)).issueId),
          ),
        );
      expect(recorded).toEqual([{ actorId: maintainer.userId }]);
    });

    it('records nothing when a merge bypassed nothing', async () => {
      const { base, number } = await pullRequest();
      await requireOn(
        base,
        { required_approving_review_count: 1 },
        {
          bypassActors: [
            { actorType: 'RepositoryRole', role: 'maintain', bypassMode: 'always' },
          ],
        },
      );
      await approve(reviewer, number);
      await merge(maintainer, number, { bypassRules: true }).expect(201);
      expect(await timelineEvents(number, 'rules_bypassed')).toEqual([]);
    });

    it('part A update rule bypassed on merge also needs the flag', async () => {
      const { base, number } = await pullRequest();
      await ruleset({
        name: `${base} frozen`,
        include: [base],
        rules: [{ type: 'update' }],
        bypassActors: [
          { actorType: 'RepositoryRole', role: 'write', bypassMode: 'pull_request' },
        ],
      });

      const asked = await merge(author, number).expect(422);
      expect(asked.body.message).toMatch(/bypass/i);
      await merge(author, number, { bypassRules: true }).expect(201);
      expect(await timelineEvents(number, 'rules_bypassed')).toHaveLength(1);
    });

    it('still refuses a non-bypasser who sends bypassRules', async () => {
      const { base, number } = await pullRequest();
      const made = await requireOn(base, { required_approving_review_count: 1 });
      const before = await serverTip(`refs/heads/${base}`);

      const refused = await merge(author, number, { bypassRules: true }).expect(422);
      expect(refused.body.message).toContain(made.name);
      expect(await serverTip(`refs/heads/${base}`)).toBe(before);
      expect(await timelineEvents(number, 'rules_bypassed')).toEqual([]);
    });

    it('refuses a merge method the rulesets do not allow', async () => {
      const { base, number } = await pullRequest();
      await requireOn(base, { allowed_merge_methods: ['rebase'] });
      await merge(author, number, { method: 'squash' }).expect(422);
      await merge(author, number, { method: 'rebase' }).expect(201);
    });

    it('merge-requirements endpoint lists violations, bypassed and allowedMethods for the viewer', async () => {
      const { base, number } = await pullRequest({ 'work/listed.txt': 'x\n' });
      const bypassable = await requireOn(
        base,
        { required_approving_review_count: 1, allowed_merge_methods: ['squash', 'rebase'] },
        {
          bypassActors: [
            { actorType: 'RepositoryRole', role: 'maintain', bypassMode: 'always' },
          ],
        },
      );
      const binding = await requireOn(base, {
        required_review_thread_resolution: true,
        allowed_merge_methods: ['squash', 'merge'],
      });
      await lineComment(second, number, 'work/listed.txt');

      const asMaintainer = await requirements(number, maintainer);
      expect(asMaintainer).toEqual({
        violations: [
          expect.objectContaining({ requirement: 'threads', rulesetId: binding.id }),
        ],
        bypassed: [
          expect.objectContaining({ requirement: 'approvals', rulesetId: bypassable.id }),
        ],
        allowedMethods: ['squash'],
      });

      const asAuthor = await requirements(number, author);
      expect(asAuthor.bypassed).toEqual([]);
      expect(asAuthor.violations.map(({ requirement }) => requirement).sort()).toEqual([
        'approvals',
        'threads',
      ]);

      const byMerge = await requirements(number, author, 'merge');
      expect(byMerge.violations).toContainEqual(
        expect.objectContaining({ requirement: 'merge_method', rulesetId: bypassable.id }),
      );
    });

    it('requires signing in for merge-requirements', async () => {
      const { number } = await pullRequest();
      await api().get(pull(number, '/merge-requirements')).expect(401);
    });

    it('disabling the ruleset unblocks immediately', async () => {
      const { base, number } = await pullRequest();
      const made = await requireOn(base, { required_approving_review_count: 1 });
      await merge(author, number).expect(422);

      await api()
        .put(`/api/repositories/${repo}/rulesets/${made.id}`)
        .set('cookie', owner.cookie)
        .send({
          name: made.name,
          target: 'branch',
          enforcement: 'disabled',
          include: made.include,
          exclude: [],
          bypassActors: [],
          rules: made.rules,
        })
        .expect(200);
      expect(await unmet(number)).toEqual([]);
      await merge(author, number).expect(201);
    });

    it('merge judges the head it loaded: a push after the approval refuses the merge before any consumer runs', async () => {
      const { base, head, number } = await pullRequest();
      await requireOn(base, {
        required_approving_review_count: 1,
        dismiss_stale_reviews_on_push: true,
      });
      await approve(reviewer, number);
      const before = await serverTip(`refs/heads/${base}`);

      commitOn(head, head);
      await pushAs(author, `${head}:refs/heads/${head}`);
      await merge(author, number).expect(422);
      expect(await serverTip(`refs/heads/${base}`)).toBe(before);
    });
  });
});
