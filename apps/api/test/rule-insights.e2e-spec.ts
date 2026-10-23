import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { type Database, schema } from '@ghost/db';
import type { INestApplication } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import { NonFastForwardError } from '../src/lib/git/wal/wal.errors.js';
import { ZERO_OID } from '../src/lib/git/wal/wal.types.js';
import { PullRequestsService } from '../src/resources/pull-requests/pull-requests.service.js';
import { ReleasesService } from '../src/resources/releases/releases.service.js';
import { RuleSuitesService } from '../src/services/rulesets/rule-suites.service.js';
import { hasBackends, signUp, startApp } from './harness.js';

type Account = Awaited<ReturnType<typeof signUp>> & { username: string };

const ADMIN_BYPASS = [
  { actorType: 'RepositoryRole', role: 'admin', bypassMode: 'always' },
];

/** Every user write a ruleset checks leaves one rule suite per targeted ref, and nothing else does. Each case uses its own branches, so rulesets never reach across cases. */
describe.skipIf(!hasBackends)('rule insights', { timeout: 30_000 }, () => {
  let app: INestApplication;
  let origin: string;
  let owner: Account;
  let writer: Account;
  let repositoryId: string;
  let work: string;
  const stamp = Date.now();
  const repo = `riowner${stamp}/insights`;
  let counter = 0;
  const api = () => request(app.getHttpServer());
  const db = () => app.get<Database>(DATABASE);
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
      { cwd: work, encoding: 'utf8' },
    ).trim();
  const remote = (account: Account) =>
    `${origin.replace('://', `://${account.username}:${account.key}@`)}/${repo}.git`;
  // The server runs in this process, so anything that talks to it must not block the event loop.
  const pushAs = (account: Account, ...args: string[]) =>
    promisify(execFile)('git', ['push', '-q', remote(account), ...args], {
      cwd: work,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  /** A new commit on `branch`, started from `from`; returns its sha and leaves it checked out. */
  const commitOn = (branch: string, from: string, file = `${branch}.txt`) => {
    git('checkout', '-q', '-B', branch, from);
    writeFileSync(path.join(work, file), `${++counter}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', `commit ${counter} on ${branch}`);
    return git('rev-parse', 'HEAD');
  };
  /** A fresh branch on the server off main, pushed before any ruleset targets it. */
  const seed = async (prefix: string) => {
    const branch = `${prefix}-${++counter}`;
    const sha = commitOn(branch, 'main');
    await pushAs(owner, `${branch}:refs/heads/${branch}`);
    return { branch, sha };
  };
  const ruleset = async (body: object) =>
    (
      await api()
        .post(`/api/repositories/${repo}/rulesets`)
        .set('cookie', owner.cookie)
        .send({
          name: `ruleset ${++counter}`,
          target: 'branch',
          enforcement: 'active',
          exclude: [],
          bypassActors: [],
          ...body,
        })
        .expect(201)
    ).body as { id: string; name: string };
  const openPull = async (head: string, base: string) =>
    (
      await api()
        .post(`/api/repositories/${repo}/pulls`)
        .set('cookie', owner.cookie)
        .send({ title: `${head} into ${base}`, base, head })
        .expect(201)
    ).body.number as number;
  const merge = (number: number, extra: object = {}) =>
    api()
      .post(`/api/repositories/${repo}/pulls/${number}/merge`)
      .set('cookie', owner.cookie)
      .send({ method: 'squash', ...extra });
  const suitesOf = async (ref: string) => {
    const suites = await db()
      .select()
      .from(schema.ruleSuite)
      .where(
        and(
          eq(schema.ruleSuite.repositoryId, repositoryId),
          eq(schema.ruleSuite.ref, ref),
        ),
      )
      .orderBy(asc(schema.ruleSuite.createdAt), asc(schema.ruleSuite.id));
    return Promise.all(
      suites.map(async (suite) => ({
        ...suite,
        evaluations: await db()
          .select()
          .from(schema.ruleEvaluation)
          .where(eq(schema.ruleEvaluation.ruleSuiteId, suite.id))
          .orderBy(asc(schema.ruleEvaluation.position)),
      })),
    );
  };
  const pullRequestIdOf = async (number: number) => {
    const [row] = await db()
      .select({ id: schema.pullRequest.id })
      .from(schema.pullRequest)
      .innerJoin(schema.issue, eq(schema.issue.id, schema.pullRequest.issueId))
      .where(
        and(
          eq(schema.issue.repositoryId, repositoryId),
          eq(schema.issue.number, number),
        ),
      );
    return row.id;
  };

  beforeAll(async () => {
    ({ app, origin } = await startApp());
    owner = { ...(await signUp(app, `riowner${stamp}`)), username: `riowner${stamp}` };
    writer = { ...(await signUp(app, `riwriter${stamp}`)), username: `riwriter${stamp}` };
    repositoryId = (
      await api()
        .post('/api/repositories')
        .set('cookie', owner.cookie)
        .send({ name: 'insights', visibility: 'public' })
        .expect(201)
    ).body.id;
    await api()
      .put(`/api/repositories/${repo}/collaborators/${writer.username}`)
      .set('cookie', owner.cookie)
      .send({ role: 'write' })
      .expect(200);
    const invitation = (
      await api().get('/api/invitations').set('cookie', writer.cookie).expect(200)
    ).body.invitations[0];
    await api()
      .post(`/api/invitations/${invitation.id}/accept`)
      .set('cookie', writer.cookie)
      .expect(204);

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-rule-insights-'));
    git('init', '-q', '-b', 'main');
    writeFileSync(path.join(work, 'suggest.txt'), 'one\ntwo\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    await pushAs(owner, 'main');
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  describe('recording', () => {
    it('records a passing push with every rule checked', async () => {
      const { branch, sha: before } = await seed('pass');
      const made = await ruleset({
        include: [branch],
        rules: [{ type: 'non_fast_forward' }, { type: 'deletion' }],
      });
      const after = commitOn(branch, branch);
      await pushAs(writer, `${branch}:refs/heads/${branch}`);

      const [suite, ...rest] = await suitesOf(`refs/heads/${branch}`);
      expect(rest).toEqual([]);
      expect(suite).toMatchObject({
        write: 'push',
        actorId: writer.userId,
        actorName: writer.username,
        beforeSha: before,
        afterSha: after,
        result: 'pass',
        evaluationResult: null,
        pullRequestId: null,
      });
      // In the ruleset's own rule order, which is the rule type's.
      expect(suite.evaluations).toMatchObject([
        {
          rulesetId: made.id,
          rulesetName: made.name,
          enforcement: 'active',
          ruleType: 'deletion',
          result: 'pass',
          requirements: [],
          details: null,
        },
        { ruleType: 'non_fast_forward', result: 'pass' },
      ]);
    });

    it('records a refused push as fail, with the message the pusher saw', async () => {
      const { branch } = await seed('refused');
      await ruleset({ include: [branch], rules: [{ type: 'update' }] });
      commitOn(branch, branch);
      await expect(pushAs(writer, `${branch}:refs/heads/${branch}`)).rejects.toThrow();

      const suites = await suitesOf(`refs/heads/${branch}`);
      expect(suites).toHaveLength(1);
      expect(suites[0].result).toBe('fail');
      expect(suites[0].evaluations).toMatchObject([
        { ruleType: 'update', result: 'fail', details: 'Cannot update this protected ref' },
      ]);
    });

    it('records a bypassed push as bypass', async () => {
      const { branch } = await seed('bypassed');
      await ruleset({
        include: [branch],
        rules: [{ type: 'update' }],
        bypassActors: ADMIN_BYPASS,
      });
      commitOn(branch, branch);
      await pushAs(owner, `${branch}:refs/heads/${branch}`);
      expect((await suitesOf(`refs/heads/${branch}`)).map(({ result }) => result)).toEqual([
        'bypass',
      ]);
    });

    it('records each targeted ref of a refused push, and none of the rest', async () => {
      const { branch: frozen } = await seed('multi-frozen');
      const { branch: watched } = await seed('multi-watched');
      const { branch: free } = await seed('multi-free');
      await ruleset({ include: [frozen], rules: [{ type: 'update' }] });
      await ruleset({ include: [watched], rules: [{ type: 'deletion' }] });
      for (const branch of [frozen, watched, free]) commitOn(branch, branch);

      await expect(
        pushAs(
          writer,
          `${frozen}:refs/heads/${frozen}`,
          `${watched}:refs/heads/${watched}`,
          `${free}:refs/heads/${free}`,
        ),
      ).rejects.toThrow();
      expect((await suitesOf(`refs/heads/${frozen}`)).map(({ result }) => result)).toEqual(['fail']);
      expect((await suitesOf(`refs/heads/${watched}`)).map(({ result }) => result)).toEqual(['pass']);
      expect(await suitesOf(`refs/heads/${free}`)).toEqual([]);
    });

    it('records nothing for a push no ruleset targets', async () => {
      const { branch } = await seed('untargeted');
      commitOn(branch, branch);
      await pushAs(writer, `${branch}:refs/heads/${branch}`);
      expect(await suitesOf(`refs/heads/${branch}`)).toEqual([]);
    });

    it('records an evaluate force-push as an evaluate failure, and a fast-forward as a pass', async () => {
      const { branch } = await seed('trial');
      await ruleset({
        include: [branch],
        enforcement: 'evaluate',
        rules: [{ type: 'non_fast_forward' }],
      });
      commitOn(branch, branch);
      await pushAs(writer, `${branch}:refs/heads/${branch}`);
      commitOn(branch, 'main');
      await pushAs(writer, `+${branch}:refs/heads/${branch}`);

      const suites = await suitesOf(`refs/heads/${branch}`);
      expect(suites.map(({ result, evaluationResult }) => [result, evaluationResult])).toEqual([
        ['pass', 'pass'],
        ['pass', 'fail'],
      ]);
      expect(suites[1].evaluations).toMatchObject([
        { enforcement: 'evaluate', result: 'fail', details: 'Cannot force-push to this branch' },
      ]);
    });

    it('records branch creation and deletion through the API', async () => {
      const branch = `api-${++counter}`;
      await ruleset({ include: [branch], rules: [{ type: 'deletion' }] });
      await api()
        .post(`/api/repositories/${repo}/branches`)
        .set('cookie', writer.cookie)
        .send({ name: branch, from: 'main' })
        .expect(201);
      await api()
        .delete(`/api/repositories/${repo}/branches/${branch}`)
        .set('cookie', writer.cookie)
        .expect(422);

      const suites = await suitesOf(`refs/heads/${branch}`);
      expect(suites.map(({ result, beforeSha, afterSha }) => [
        result,
        beforeSha === ZERO_OID.toString('hex'),
        afterSha === ZERO_OID.toString('hex'),
      ])).toEqual([
        ['pass', true, false],
        ['fail', false, true],
      ]);
    });

    it('records a release tag', async () => {
      const tag = `v${++counter}`;
      await ruleset({ target: 'tag', include: [tag], rules: [{ type: 'deletion' }] });
      await api()
        .post(`/api/repositories/${repo}/releases`)
        .set('cookie', writer.cookie)
        .send({ tagName: tag })
        .expect(201);
      expect((await suitesOf(`refs/tags/${tag}`)).map(({ result }) => result)).toEqual(['pass']);
    });

    it('records deleting a tag', async () => {
      const tag = `gone${++counter}`;
      await api()
        .post(`/api/repositories/${repo}/releases`)
        .set('cookie', writer.cookie)
        .send({ tagName: tag })
        .expect(201);
      await ruleset({ target: 'tag', include: [tag], rules: [{ type: 'deletion' }] });
      await expect(
        app.get(ReleasesService).deleteTag({
          username: owner.username,
          repo: 'insights',
          requesterId: writer.userId,
          tagName: tag,
        }),
      ).rejects.toThrow();
      expect((await suitesOf(`refs/tags/${tag}`)).map(({ result, afterSha }) => [result, afterSha])).toEqual([
        ['fail', ZERO_OID.toString('hex')],
      ]);
    });

    it('records an evaluate pull_request rule the merge would have failed', async () => {
      const { branch: base } = await seed('merge-trial');
      commitOn(`${base}-work`, base);
      await pushAs(owner, `${base}-work:refs/heads/${base}-work`);
      const number = await openPull(`${base}-work`, base);
      await ruleset({
        include: [base],
        enforcement: 'evaluate',
        rules: [
          {
            type: 'pull_request',
            parameters: {
              required_approving_review_count: 1,
              dismiss_stale_reviews_on_push: false,
              require_code_owner_review: false,
              require_last_push_approval: false,
              required_review_thread_resolution: false,
              allowed_merge_methods: ['merge', 'squash', 'rebase'],
            },
          },
        ],
      });

      await merge(number).expect(201);
      const [suite] = await suitesOf(`refs/heads/${base}`);
      expect([suite.result, suite.evaluationResult]).toEqual(['pass', 'fail']);
      expect(suite.evaluations).toMatchObject([
        { enforcement: 'evaluate', ruleType: 'pull_request', result: 'fail', requirements: ['approvals'] },
      ]);
    });

    it('records applying a suggestion', async () => {
      const branch = `suggest-${++counter}`;
      git('checkout', '-q', '-B', branch, 'main');
      writeFileSync(path.join(work, 'suggest.txt'), 'one\ntwo\nthree\n');
      git('add', '-A');
      git('commit', '-q', '-m', 'to suggest on');
      await pushAs(owner, `${branch}:refs/heads/${branch}`);
      const number = await openPull(branch, 'main');
      const { body } = await api()
        .post(`/api/repositories/${repo}/pulls/${number}/reviews`)
        .set('cookie', writer.cookie)
        .send({
          state: 'commented',
          comments: [
            { path: 'suggest.txt', side: 'additions', line: 3, body: '```suggestion\nTHREE\n```' },
          ],
        })
        .expect(201);
      await ruleset({ include: [branch], rules: [{ type: 'deletion' }] });
      await api()
        .post(`/api/repositories/${repo}/pulls/${number}/comments/${body.comments[0].id}/apply`)
        .set('cookie', owner.cookie)
        .expect(201);
      expect((await suitesOf(`refs/heads/${branch}`)).map(({ result, write }) => [result, write])).toEqual([
        ['pass', 'push'],
      ]);
    });

    it('records a refused merge and a landed one with the pull request', async () => {
      const { branch: base } = await seed('merge-base');
      commitOn(`${base}-work`, base);
      await pushAs(owner, `${base}-work:refs/heads/${base}-work`);
      const number = await openPull(`${base}-work`, base);
      const frozen = await ruleset({ include: [base], rules: [{ type: 'update' }] });

      await merge(number).expect(422);
      await api()
        .delete(`/api/repositories/${repo}/rulesets/${frozen.id}`)
        .set('cookie', owner.cookie)
        .expect(204);
      await ruleset({ include: [base], rules: [{ type: 'deletion' }] });
      await merge(number).expect(201);

      const pullRequestId = await pullRequestIdOf(number);
      const suites = await suitesOf(`refs/heads/${base}`);
      expect(suites.map(({ result, write, pullRequestId }) => [result, write, pullRequestId])).toEqual([
        ['fail', 'pull_request_merge', pullRequestId],
        ['pass', 'pull_request_merge', pullRequestId],
      ]);
      expect(suites[0].evaluations).toMatchObject([
        { rulesetId: null, rulesetName: frozen.name, ruleType: 'update', result: 'fail' },
      ]);
    });

    it('records a landed merge even when the bookkeeping after it fails', async () => {
      const { branch: base } = await seed('merge-bookkeeping');
      commitOn(`${base}-work`, base);
      await pushAs(owner, `${base}-work:refs/heads/${base}-work`);
      const number = await openPull(`${base}-work`, base);
      await ruleset({ include: [base], rules: [{ type: 'update' }], bypassActors: ADMIN_BYPASS });
      const afterPush = vi
        .spyOn(app.get(PullRequestsService), 'afterPush')
        .mockRejectedValueOnce(new Error('bookkeeping failed'));

      try {
        await merge(number, { bypassRules: true }).expect(500);
      } finally {
        afterPush.mockRestore();
      }
      expect((await suitesOf(`refs/heads/${base}`)).map(({ result }) => result)).toEqual(['bypass']);
    });

    it('records nothing for a merge that asks the bypasser to opt in, and bypass once they do', async () => {
      const { branch: base } = await seed('merge-optin');
      commitOn(`${base}-work`, base);
      await pushAs(owner, `${base}-work:refs/heads/${base}-work`);
      const number = await openPull(`${base}-work`, base);
      await ruleset({ include: [base], rules: [{ type: 'update' }], bypassActors: ADMIN_BYPASS });

      await merge(number).expect(422);
      expect(await suitesOf(`refs/heads/${base}`)).toEqual([]);
      await merge(number, { bypassRules: true }).expect(201);
      expect((await suitesOf(`refs/heads/${base}`)).map(({ result }) => result)).toEqual(['bypass']);
    });

    it('records nothing for merge requirements, the merge box or gh views', async () => {
      const { branch: base } = await seed('merge-view');
      commitOn(`${base}-work`, base);
      await pushAs(owner, `${base}-work:refs/heads/${base}-work`);
      const number = await openPull(`${base}-work`, base);
      await ruleset({ include: [base], rules: [{ type: 'update' }] });

      for (let i = 0; i < 2; i++)
        await api()
          .get(`/api/repositories/${repo}/pulls/${number}/merge-requirements`)
          .set('cookie', owner.cookie)
          .expect(200);
      await api()
        .get(`/api/v3/repos/${repo}/pulls/${number}`)
        .set('authorization', `token ${owner.key}`)
        .expect(200);
      const { body } = await api()
        .post('/api/graphql')
        .set('authorization', `token ${owner.key}`)
        .send({
          query: `query($owner: String!, $number: Int!) { repository(owner: $owner, name: "insights") { pullRequest(number: $number) { mergeStateStatus reviewDecision } } }`,
          variables: { owner: owner.username, number },
        })
        .expect(200);
      expect(body.errors).toBeUndefined();
      expect(await suitesOf(`refs/heads/${base}`)).toEqual([]);
    });

    it('records nothing when the rulesets allowed a write that then failed', async () => {
      const ref = `refs/heads/lost-${++counter}`;
      const transition = { ref, oldOid: Buffer.alloc(20, 1), newOid: Buffer.alloc(20, 2) };
      await expect(
        app.get(RuleSuitesService).attempt(
          {
            repositoryId,
            actorId: writer.userId,
            verdict: {
              transitions: [transition],
              write: 'push',
              violations: [],
              bypassed: [],
              suites: [{ transition, result: 'pass', evaluationResult: null, evaluations: [] }],
            },
          },
          () => Promise.reject(new NonFastForwardError(ref)),
        ),
      ).rejects.toThrow(NonFastForwardError);
      expect(await suitesOf(ref)).toEqual([]);
    });
  });

  describe('api', () => {
    type Listed = {
      ruleSuites: {
        id: string;
        actor: { id: string; username: string } | null;
        actorName: string | null;
        ref: string;
        afterSha: string;
        result: string;
        evaluationResult: string | null;
        pullRequest: { number: number } | null;
        evaluations: {
          rulesetId: string | null;
          rulesetName: string;
          enforcement: string;
          rule: string;
          result: string;
          details: string | null;
        }[];
      }[];
      nextCursor: string | null;
    };
    const list = async (query: Record<string, string | number>, viewer = owner) =>
      (
        await api()
          .get(`/api/repositories/${repo}/rule-suites`)
          .query(query)
          .set('cookie', viewer.cookie)
          .expect(200)
      ).body as Listed;

    it('lists newest first, a page at a time', async () => {
      const { branch } = await seed('listed');
      await ruleset({ include: [branch], rules: [{ type: 'deletion' }] });
      const shas: string[] = [];
      for (let i = 0; i < 3; i++) {
        shas.push(commitOn(branch, branch));
        await pushAs(writer, `${branch}:refs/heads/${branch}`);
      }

      const first = await list({ ref: branch, limit: 2 });
      expect(first.ruleSuites.map(({ afterSha }) => afterSha)).toEqual([shas[2], shas[1]]);
      expect(first.ruleSuites[0]).toMatchObject({
        actor: { id: writer.userId, username: writer.username },
        actorName: writer.username,
        ref: `refs/heads/${branch}`,
        result: 'pass',
        evaluationResult: null,
        pullRequest: null,
        evaluations: [{ rule: 'deletion', result: 'pass', enforcement: 'active', details: null }],
      });
      const second = await list({ ref: branch, limit: 2, cursor: first.nextCursor! });
      expect(second.ruleSuites.map(({ afterSha }) => afterSha)).toEqual([shas[0]]);
      expect(second.nextCursor).toBeNull();
    });

    it('pages through the refs of one push without skipping any', async () => {
      const branches = [];
      for (let i = 0; i < 3; i++) branches.push((await seed(`paged-${i}`)).branch);
      const made = await ruleset({ include: branches, rules: [{ type: 'deletion' }] });
      for (const branch of branches) commitOn(branch, branch);
      await pushAs(writer, ...branches.map((branch) => `${branch}:refs/heads/${branch}`));

      const first = await list({ rulesetId: made.id, limit: 2 });
      const second = await list({ rulesetId: made.id, limit: 2, cursor: first.nextCursor! });
      expect(
        [...first.ruleSuites, ...second.ruleSuites].map(({ ref }) => ref).sort(),
      ).toEqual(branches.map((branch) => `refs/heads/${branch}`).sort());
    });

    it('filters by ruleset, ref, actor, result, enforcement and period', async () => {
      const { branch } = await seed('filtered');
      const guard = await ruleset({
        include: [branch],
        rules: [{ type: 'update' }],
        bypassActors: ADMIN_BYPASS,
      });
      const other = await ruleset({ include: ['nothing-here'], rules: [{ type: 'deletion' }] });
      await ruleset({ include: [branch], enforcement: 'evaluate', rules: [{ type: 'deletion' }] });
      commitOn(branch, branch);
      await pushAs(owner, `${branch}:refs/heads/${branch}`);
      commitOn(branch, branch);
      await expect(pushAs(writer, `${branch}:refs/heads/${branch}`)).rejects.toThrow();
      const { branch: plain } = await seed('filtered-plain');
      await ruleset({ include: [plain], rules: [{ type: 'deletion' }] });
      commitOn(plain, plain);
      await pushAs(writer, `${plain}:refs/heads/${plain}`);

      const results = async (query: Record<string, string>) =>
        (await list(query)).ruleSuites.map(({ result }) => result);
      expect(await results({ ref: branch })).toEqual(['fail', 'bypass']);
      expect(await results({ ref: `refs/heads/${branch}` })).toEqual(['fail', 'bypass']);
      expect(await results({ ref: branch, actor: writer.username })).toEqual(['fail']);
      expect(await results({ ref: branch, result: 'bypass' })).toEqual(['bypass']);
      expect(await results({ ref: branch, rulesetId: guard.id })).toEqual(['fail', 'bypass']);
      expect(await results({ ref: branch, rulesetId: other.id })).toEqual([]);
      expect(await results({ ref: branch, enforcement: 'evaluate' })).toEqual(['fail', 'bypass']);
      expect(await results({ ref: plain, enforcement: 'evaluate' })).toEqual([]);
      expect(await results({ ref: plain, enforcement: 'active' })).toEqual(['pass']);

      await db()
        .update(schema.ruleSuite)
        .set({ createdAt: sql`now() - interval '2 hours'` })
        .where(eq(schema.ruleSuite.ref, `refs/heads/${plain}`));
      expect(await results({ ref: plain, period: 'hour' })).toEqual([]);
      expect(await results({ ref: plain })).toEqual(['pass']);
      expect(await results({ ref: plain, period: 'all' })).toEqual(['pass']);
    });

    it('keeps a ruleset’s old name after a rename, and marks it deleted once it is gone', async () => {
      const { branch } = await seed('renamed');
      const body = {
        name: `before ${++counter}`,
        target: 'branch',
        enforcement: 'active',
        include: [branch],
        exclude: [],
        bypassActors: [],
        rules: [{ type: 'deletion' }],
      };
      const made = await ruleset(body);
      commitOn(branch, branch);
      await pushAs(writer, `${branch}:refs/heads/${branch}`);
      await api()
        .put(`/api/repositories/${repo}/rulesets/${made.id}`)
        .set('cookie', owner.cookie)
        .send({ ...body, name: `after ${counter}` })
        .expect(200);
      expect((await list({ ref: branch })).ruleSuites[0].evaluations[0]).toMatchObject({
        rulesetId: made.id,
        rulesetName: body.name,
        enforcement: 'active',
      });

      await api()
        .delete(`/api/repositories/${repo}/rulesets/${made.id}`)
        .set('cookie', owner.cookie)
        .expect(204);
      expect((await list({ ref: branch })).ruleSuites[0].evaluations[0]).toMatchObject({
        rulesetId: null,
        rulesetName: body.name,
        enforcement: 'deleted ruleset',
      });
    });

    it('shows insights to admins only', async () => {
      await api()
        .get(`/api/repositories/${repo}/rule-suites`)
        .set('cookie', writer.cookie)
        .expect(403);
      await api().get(`/api/repositories/${repo}/rule-suites`).expect(401);
    });

    it('refuses an unknown filter value', async () => {
      for (const query of [{ result: 'maybe' }, { period: 'year' }, { enforcement: 'disabled' }])
        await api()
          .get(`/api/repositories/${repo}/rule-suites`)
          .query(query)
          .set('cookie', owner.cookie)
          .expect(400);
    });
  });
});
