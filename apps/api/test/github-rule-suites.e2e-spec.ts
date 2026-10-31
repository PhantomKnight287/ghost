import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { type Database, schema } from '@ghost/db';
import type { INestApplication } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import { hasBackends, signUp, startApp } from './harness.js';

type Account = Awaited<ReturnType<typeof signUp>> & { username: string };

/** GitHub's `GET /repos/{owner}/{repo}/rulesets/rule-suites` and `/rule-suites/{id}`, over the suites Ghost records on every checked write. */
describe.skipIf(!hasBackends)('GitHub rule suites', { timeout: 30_000 }, () => {
  let app: INestApplication;
  let origin: string;
  let owner: Account;
  let writer: Account;
  let work: string;
  const stamp = Date.now();
  const ownerName = `ghsuowner${stamp}`;
  const repo = `${ownerName}/suites`;
  let counter = 0;
  const http = () => request(app.getHttpServer());
  const db = () => app.get<Database>(DATABASE);
  const rest = (who: Account | null) => ({
    get: (url: string) => {
      const call = http().get(`/api/v3/repos/${repo}${url}`);
      return who ? call.set('authorization', `token ${who.key}`) : call;
    },
    post: (url: string, body: object) =>
      http()
        .post(`/api/v3/repos/${repo}${url}`)
        .set('authorization', `token ${who!.key}`)
        .send(body),
  });
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
  const commitOn = (branch: string, from: string) => {
    git('checkout', '-q', '-B', branch, from);
    writeFileSync(path.join(work, `${branch}.txt`), `${++counter}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', `commit ${counter} on ${branch}`);
    return git('rev-parse', 'HEAD');
  };
  const seed = async (prefix: string) => {
    const branch = `${prefix}-${++counter}`;
    commitOn(branch, 'main');
    await pushAs(owner, `${branch}:refs/heads/${branch}`);
    return branch;
  };
  const ruleset = async (branch: string, overrides: object = {}) =>
    (
      await rest(owner)
        .post('/rulesets', {
          name: `rules ${++counter}`,
          target: 'branch',
          enforcement: 'active',
          conditions: {
            ref_name: { include: [`refs/heads/${branch}`], exclude: [] },
          },
          rules: [{ type: 'update' }],
          ...overrides,
        })
        .expect(201)
    ).body as { id: number; name: string };
  const numericIdOf = async (userId: string) =>
    (
      await db()
        .select({ numericId: schema.user.numericId })
        .from(schema.user)
        .where(eq(schema.user.id, userId))
    )[0].numericId;

  beforeAll(async () => {
    ({ app, origin } = await startApp());
    owner = { ...(await signUp(app, ownerName)), username: ownerName };
    writer = {
      ...(await signUp(app, `ghsuwriter${stamp}`)),
      username: `ghsuwriter${stamp}`,
    };
    await http()
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: 'suites', visibility: 'public' })
      .expect(201);
    await http()
      .put(`/api/repositories/${repo}/collaborators/${writer.username}`)
      .set('cookie', owner.cookie)
      .send({ role: 'write' })
      .expect(200);
    const invitation = (
      await http()
        .get('/api/invitations')
        .set('cookie', writer.cookie)
        .expect(200)
    ).body.invitations[0];
    await http()
      .post(`/api/invitations/${invitation.id}/accept`)
      .set('cookie', writer.cookie)
      .expect(204);

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-github-rule-suites-'));
    git('init', '-q', '-b', 'main');
    writeFileSync(path.join(work, 'a.txt'), 'a\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    await pushAs(owner, 'main');
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('lists suites newest first in GitHub’s shape, a page at a time', async () => {
    const branch = await seed('listed');
    await ruleset(branch, { rules: [{ type: 'deletion' }] });
    const before = git('rev-parse', branch);
    const first = commitOn(branch, branch);
    await pushAs(writer, `${branch}:refs/heads/${branch}`);
    const second = commitOn(branch, branch);
    await pushAs(writer, `${branch}:refs/heads/${branch}`);

    const page = await rest(owner)
      .get(`/rulesets/rule-suites?ref=${branch}&per_page=1`)
      .expect(200);
    expect(page.headers.link).toContain('rel="next"');
    const repository = (await rest(owner).get('').expect(200)).body;
    expect(page.body).toEqual([
      {
        id: expect.any(Number),
        actor_id: await numericIdOf(writer.userId),
        actor_name: writer.username,
        before_sha: first,
        after_sha: second,
        ref: `refs/heads/${branch}`,
        repository_id: repository.id,
        repository_name: 'suites',
        pushed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        result: 'pass',
        evaluation_result: null,
      },
    ]);
    const next = await rest(owner)
      .get(`/rulesets/rule-suites?ref=${branch}&per_page=1&page=2`)
      .expect(200);
    expect(
      next.body.map(({ before_sha }: { before_sha: string }) => before_sha),
    ).toEqual([before]);
  });

  it('filters by actor, result, evaluate status and time period', async () => {
    const branch = await seed('filtered');
    await ruleset(branch, {
      bypass_actors: [
        { actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' },
      ],
    });
    await ruleset(branch, {
      enforcement: 'evaluate',
      rules: [{ type: 'deletion' }],
    });
    commitOn(branch, branch);
    await pushAs(owner, `${branch}:refs/heads/${branch}`);
    commitOn(branch, branch);
    await expect(
      pushAs(writer, `${branch}:refs/heads/${branch}`),
    ).rejects.toThrow();
    const plain = await seed('filtered-plain');
    await ruleset(plain, { rules: [{ type: 'deletion' }] });
    commitOn(plain, plain);
    await pushAs(writer, `${plain}:refs/heads/${plain}`);

    const results = async (query: string) =>
      (
        await rest(owner).get(`/rulesets/rule-suites?${query}`).expect(200)
      ).body.map(({ result }: { result: string }) => result);
    expect(await results(`ref=refs/heads/${branch}`)).toEqual([
      'fail',
      'bypass',
    ]);
    expect(
      await results(`ref=${branch}&actor_name=${writer.username}`),
    ).toEqual(['fail']);
    expect(await results(`ref=${branch}&rule_suite_result=bypass`)).toEqual([
      'bypass',
    ]);
    expect(await results(`ref=${branch}&rule_suite_result=all`)).toEqual([
      'fail',
      'bypass',
    ]);
    expect(await results(`ref=${branch}&evaluate_status=evaluate`)).toEqual([
      'fail',
      'bypass',
    ]);
    expect(await results(`ref=${plain}&evaluate_status=evaluate`)).toEqual([]);
    expect(await results(`ref=${plain}&evaluate_status=active`)).toEqual([
      'pass',
    ]);

    await db()
      .update(schema.ruleSuite)
      .set({ createdAt: sql`now() - interval '2 hours'` })
      .where(eq(schema.ruleSuite.ref, `refs/heads/${plain}`));
    expect(await results(`ref=${plain}&time_period=hour`)).toEqual([]);
    expect(await results(`ref=${plain}`)).toEqual(['pass']);
  });

  it('answers one suite with its rule evaluations', async () => {
    const branch = await seed('detail');
    const made = await ruleset(branch);
    commitOn(branch, branch);
    await expect(
      pushAs(writer, `${branch}:refs/heads/${branch}`),
    ).rejects.toThrow();
    const [listed] = (
      await rest(owner).get(`/rulesets/rule-suites?ref=${branch}`).expect(200)
    ).body;

    const { body } = await rest(owner)
      .get(`/rulesets/rule-suites/${listed.id}`)
      .expect(200);
    expect(body).toEqual({
      ...listed,
      rule_evaluations: [
        {
          rule_source: { type: 'ruleset', id: made.id, name: made.name },
          enforcement: 'active',
          result: 'fail',
          rule_type: 'update',
          details: 'Cannot update this protected ref',
        },
      ],
    });

    await http()
      .delete(`/api/v3/repos/${repo}/rulesets/${made.id}`)
      .set('authorization', `token ${owner.key}`)
      .expect(204);
    const after = await rest(owner)
      .get(`/rulesets/rule-suites/${listed.id}`)
      .expect(200);
    expect(after.body.rule_evaluations[0]).toMatchObject({
      rule_source: { type: 'ruleset', id: null, name: made.name },
      enforcement: 'deleted ruleset',
    });
  });

  it('adds the pull request to a merge’s pull_request rule with include_metadata', async () => {
    const base = await seed('merged');
    commitOn(`${base}-work`, base);
    await pushAs(owner, `${base}-work:refs/heads/${base}-work`);
    const { number, id } = (
      await rest(owner)
        .post('/pulls', { title: 'work', head: `${base}-work`, base })
        .expect(201)
    ).body;
    await ruleset(base, {
      rules: [
        {
          type: 'pull_request',
          parameters: {
            required_approving_review_count: 0,
            dismiss_stale_reviews_on_push: false,
            require_code_owner_review: false,
            require_last_push_approval: false,
            required_review_thread_resolution: false,
          },
        },
      ],
    });
    await http()
      .put(`/api/v3/repos/${repo}/pulls/${number}/merge`)
      .set('authorization', `token ${owner.key}`)
      .send({ merge_method: 'squash' })
      .expect(200);
    const [listed] = (
      await rest(owner).get(`/rulesets/rule-suites?ref=${base}`).expect(200)
    ).body;

    const plain = await rest(owner)
      .get(`/rulesets/rule-suites/${listed.id}`)
      .expect(200);
    expect(plain.body.rule_evaluations[0].metadata).toBeUndefined();
    const { body } = await rest(owner)
      .get(`/rulesets/rule-suites/${listed.id}?include_metadata=true`)
      .expect(200);
    expect(body.rule_evaluations[0]).toMatchObject({
      rule_type: 'pull_request',
      result: 'pass',
      metadata: {
        pull_request: {
          id,
          number,
          user: {
            id: await numericIdOf(owner.userId),
            login: owner.username,
            type: 'User',
          },
          reviews: [],
        },
      },
    });
  });

  it('is routed apart from rulesets/:id', async () => {
    const { body } = await rest(owner).get('/rulesets/rule-suites').expect(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('answers 404 to anyone but admins, and for an unknown suite', async () => {
    await rest(writer).get('/rulesets/rule-suites').expect(404);
    await rest(null).get('/rulesets/rule-suites').expect(404);
    await rest(owner).get('/rulesets/rule-suites/999999999').expect(404);
    await rest(owner).get('/rulesets/rule-suites/not-a-number').expect(404);
  });

  it('refuses an unknown filter value with 422', async () => {
    for (const query of [
      'time_period=year',
      'rule_suite_result=maybe',
      'evaluate_status=sometimes',
    ])
      await rest(owner).get(`/rulesets/rule-suites?${query}`).expect(422);
  });
});
