import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Auth } from '../src/lib/auth.js';
import { hasBackends, signUp, startApp } from './harness.js';

type Account = Awaited<ReturnType<typeof signUp>> & { username: string };

const NO_REQUIREMENTS = {
  required_approving_review_count: 0,
  dismiss_stale_reviews_on_push: false,
  require_code_owner_review: false,
  require_last_push_approval: false,
  required_review_thread_resolution: false,
  allowed_merge_methods: ['merge', 'squash', 'rebase'],
};

/** What gh and GitHub API clients see of the pull_request rule: reviewDecision, mergeStateStatus, mergeable_state, refused merges over REST and GraphQL, and repository.rulesets. gh itself is driven in gh-cli.e2e-spec.ts. */
describe.skipIf(!hasBackends)(
  'GitHub pull request rules',
  { timeout: 30_000 },
  () => {
    let app: INestApplication;
    let origin: string;
    let owner: Account;
    let author: Account;
    let reviewer: Account;
    let maintainer: Account;
    let work: string;
    const stamp = Date.now();
    const org = `ghprorg${stamp}`;
    const name = 'ruled';
    const repo = `${org}/${name}`;
    let counter = 0;

    const http = () => request(app.getHttpServer());
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
    const account = async (prefix: string): Promise<Account> => {
      const username = `${prefix}${stamp}`;
      return { ...(await signUp(app, username)), username };
    };
    const collaborate = async (who: Account, role: string) => {
      await http()
        .put(`/api/repositories/${repo}/collaborators/${who.username}`)
        .set('cookie', owner.cookie)
        .send({ role })
        .expect(200);
      const invitation = (
        await http()
          .get('/api/invitations')
          .set('cookie', who.cookie)
          .expect(200)
      ).body.invitations[0];
      await http()
        .post(`/api/invitations/${invitation.id}/accept`)
        .set('cookie', who.cookie)
        .expect(204);
    };
    const rest = (who: Account) => ({
      get: (url: string) =>
        http()
          .get(`/api/v3/repos/${repo}${url}`)
          .set('authorization', `token ${who.key}`),
      put: (url: string, body: object) =>
        http()
          .put(`/api/v3/repos/${repo}${url}`)
          .set('authorization', `token ${who.key}`)
          .send(body),
    });
    const graphql = async (
      who: Account,
      query: string,
      variables: object = {},
    ) =>
      (
        await http()
          .post('/api/graphql')
          .set('authorization', `token ${who.key}`)
          .send({ query, variables })
          .expect(200)
      ).body;

    /** A fresh base branch off main and an open pull request into it from `author`. */
    const pullRequest = async () => {
      const base = `base-${++counter}`;
      git('checkout', '-q', '-B', base, 'main');
      await pushAs(owner, `${base}:refs/heads/${base}`);
      const head = `${base}-head`;
      git('checkout', '-q', '-B', head, base);
      writeFileSync(path.join(work, `${head}.txt`), `${head}\n`);
      git('add', '-A');
      git('commit', '-q', '-m', `work on ${head}`);
      await pushAs(author, `${head}:refs/heads/${head}`);
      const number = (
        await http()
          .post(`/api/repositories/${repo}/pulls`)
          .set('cookie', author.cookie)
          .send({ title: head, base, head })
          .expect(201)
      ).body.number as number;
      return { base, head, number };
    };
    const requireOn = async (
      base: string,
      parameters: Partial<typeof NO_REQUIREMENTS>,
      bypassActors: object[] = [],
    ) =>
      (
        await http()
          .post(`/api/repositories/${repo}/rulesets`)
          .set('cookie', owner.cookie)
          .send({
            name: `${base} rules ${++counter}`,
            target: 'branch',
            enforcement: 'active',
            include: [base],
            exclude: [],
            bypassActors,
            rules: [
              {
                type: 'pull_request',
                parameters: { ...NO_REQUIREMENTS, ...parameters },
              },
            ],
          })
          .expect(201)
      ).body;
    const maintainers = [
      { actorType: 'RepositoryRole', role: 'maintain', bypassMode: 'always' },
    ];
    const review = (
      who: Account,
      number: number,
      state: string,
      body?: string,
    ) =>
      http()
        .post(`/api/repositories/${repo}/pulls/${number}/reviews`)
        .set('cookie', who.cookie)
        .send({ state, body })
        .expect(201);
    const thread = (who: Account, number: number, head: string) =>
      http()
        .post(`/api/repositories/${repo}/pulls/${number}/reviews`)
        .set('cookie', who.cookie)
        .send({
          state: 'commented',
          comments: [
            { path: `${head}.txt`, side: 'additions', line: 1, body: 'Why?' },
          ],
        })
        .expect(201);
    const pullFields = async (who: Account, number: number) => {
      const body = await graphql(
        who,
        `query($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) { id state reviewDecision mergeable mergeStateStatus }
        }
      }`,
        { owner: org, name, number },
      );
      expect(body.errors).toBeUndefined();
      return body.data.repository.pullRequest;
    };
    const mergeMutation = (who: Account, pullRequestId: string) =>
      graphql(
        who,
        `mutation($input: MergePullRequestInput!) {
        mergePullRequest(input: $input) { pullRequest { state merged } }
      }`,
        { input: { pullRequestId, mergeMethod: 'SQUASH' } },
      );

    beforeAll(async () => {
      ({ app, origin } = await startApp());
      owner = await account('ghprowner');
      author = await account('ghprauthor');
      reviewer = await account('ghprreviewer');
      maintainer = await account('ghprmaint');
      await auth().createOrganization({
        body: { name: 'GitHub pull request rules', slug: org },
        headers: new Headers({ cookie: owner.cookie }),
      });
      await http()
        .post('/api/repositories')
        .set('cookie', owner.cookie)
        .send({ name, organization: org, visibility: 'public' })
        .expect(201);
      await collaborate(author, 'write');
      await collaborate(reviewer, 'write');
      await collaborate(maintainer, 'maintain');

      work = mkdtempSync(
        path.join(tmpdir(), 'ghost-e2e-gh-pull-request-rules-'),
      );
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

    describe('REST', () => {
      it('answers mergeable_state blocked while a requirement is unmet, and clean once it is met', async () => {
        const { base, number } = await pullRequest();
        await requireOn(base, { required_approving_review_count: 1 });
        expect(
          (await rest(author).get(`/pulls/${number}`).expect(200)).body,
        ).toMatchObject({
          mergeable: true,
          mergeable_state: 'blocked',
        });

        await review(reviewer, number, 'approved');
        expect(
          (await rest(author).get(`/pulls/${number}`).expect(200)).body
            .mergeable_state,
        ).toBe('clean');
      });

      it('judges mergeable_state and mergeStateStatus by a method the rules allow, not merge', async () => {
        const { base, number } = await pullRequest();
        await requireOn(base, { allowed_merge_methods: ['squash'] });
        expect(
          (await rest(author).get(`/pulls/${number}`).expect(200)).body
            .mergeable_state,
        ).toBe('clean');
        expect(await pullFields(author, number)).toMatchObject({
          mergeStateStatus: 'CLEAN',
        });
      });

      it('answers mergeable_state blocked to a bypass actor too', async () => {
        const { base, number } = await pullRequest();
        await requireOn(
          base,
          { required_approving_review_count: 1 },
          maintainers,
        );
        expect(
          (await rest(maintainer).get(`/pulls/${number}`).expect(200)).body
            .mergeable_state,
        ).toBe('blocked');
      });

      it('refuses a merge with 405 listing every unmet requirement and its ruleset', async () => {
        const { base, head, number } = await pullRequest();
        const approvals = await requireOn(base, {
          required_approving_review_count: 1,
        });
        const threads = await requireOn(base, {
          required_review_thread_resolution: true,
        });
        await thread(reviewer, number, head);
        const before = await serverTip(`refs/heads/${base}`);

        const { body } = await rest(author)
          .put(`/pulls/${number}/merge`, { merge_method: 'squash' })
          .expect(405);
        expect(body).toMatchObject({ message: expect.any(String) });
        expect(body.message).toContain(approvals.name);
        expect(body.message).toContain(threads.name);
        expect(await serverTip(`refs/heads/${base}`)).toBe(before);
      });

      it('refuses a method the rules leave out with 405 and only GitHub’s method message', async () => {
        const { base, number } = await pullRequest();
        await requireOn(base, {
          required_approving_review_count: 1,
          allowed_merge_methods: ['merge'],
        });
        const { body } = await rest(author)
          .put(`/pulls/${number}/merge`, { merge_method: 'squash' })
          .expect(405);
        expect(body.message).toBe(
          'Squash merges are not allowed on this repository.',
        );
      });

      it('merges for a bypass actor without any flag, and records the bypass', async () => {
        const { base, number } = await pullRequest();
        await requireOn(
          base,
          { required_approving_review_count: 1 },
          maintainers,
        );

        const { body } = await rest(maintainer)
          .put(`/pulls/${number}/merge`, { merge_method: 'squash' })
          .expect(200);
        expect(body).toMatchObject({ merged: true });
        const timeline = (
          await http()
            .get(`/api/repositories/${repo}/issues/${number}/timeline`)
            .expect(200)
        ).body.timeline.filter(
          (item: { kind: string; event?: { type: string } }) =>
            item.kind === 'event' && item.event?.type === 'rules_bypassed',
        );
        expect(timeline).toHaveLength(1);
      });
    });

    describe('GraphQL', () => {
      it('derives reviewDecision from the rule: REVIEW_REQUIRED, CHANGES_REQUESTED, then APPROVED', async () => {
        const { base, number } = await pullRequest();
        await requireOn(base, { required_approving_review_count: 1 });
        expect(await pullFields(author, number)).toMatchObject({
          reviewDecision: 'REVIEW_REQUIRED',
        });

        await review(reviewer, number, 'changes_requested', 'Please fix');
        expect(await pullFields(author, number)).toMatchObject({
          reviewDecision: 'CHANGES_REQUESTED',
        });

        await review(reviewer, number, 'approved');
        expect(await pullFields(author, number)).toMatchObject({
          reviewDecision: 'APPROVED',
        });
      });

      it('answers null without a rule requiring reviews, even once approved', async () => {
        const { number } = await pullRequest();
        await review(reviewer, number, 'approved');
        expect(await pullFields(author, number)).toMatchObject({
          reviewDecision: null,
        });
      });

      it('answers CHANGES_REQUESTED under a rule that requires no approvals', async () => {
        const { base, number } = await pullRequest();
        await requireOn(base, {});
        await review(reviewer, number, 'changes_requested', 'Please fix');
        expect(await pullFields(author, number)).toMatchObject({
          reviewDecision: 'CHANGES_REQUESTED',
          mergeStateStatus: 'BLOCKED',
        });
      });

      it('answers REVIEW_REQUIRED while code owners are waiting', async () => {
        const base = `base-${++counter}`;
        git('checkout', '-q', '-B', base, 'main');
        writeFileSync(
          path.join(work, 'CODEOWNERS'),
          `* @${reviewer.username}\n`,
        );
        git('add', '-A');
        git('commit', '-q', '-m', 'owners');
        await pushAs(owner, `${base}:refs/heads/${base}`);
        const head = `${base}-head`;
        git('checkout', '-q', '-B', head, base);
        writeFileSync(path.join(work, 'owned.txt'), 'owned\n');
        git('add', '-A');
        git('commit', '-q', '-m', 'owned change');
        await pushAs(author, `${head}:refs/heads/${head}`);
        const number = (
          await http()
            .post(`/api/repositories/${repo}/pulls`)
            .set('cookie', author.cookie)
            .send({ title: head, base, head })
            .expect(201)
        ).body.number as number;
        await requireOn(base, { require_code_owner_review: true });

        expect(await pullFields(author, number)).toMatchObject({
          reviewDecision: 'REVIEW_REQUIRED',
        });
        await review(reviewer, number, 'approved');
        expect(await pullFields(author, number)).toMatchObject({
          reviewDecision: 'APPROVED',
        });
      });

      it('answers as GitHub does without a rule, and leaves branchProtectionRule null under one', async () => {
        const free = await pullRequest();
        expect(await pullFields(author, free.number)).toMatchObject({
          reviewDecision: null,
        });

        const { base, number } = await pullRequest();
        await requireOn(base, { required_approving_review_count: 1 });
        const body = await graphql(
          author,
          `query($owner: String!, $name: String!, $number: Int!) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) { baseRef { branchProtectionRule { id } } }
          }
        }`,
          { owner: org, name, number },
        );
        expect(body.errors).toBeUndefined();
        expect(body.data.repository.pullRequest.baseRef).toEqual({
          branchProtectionRule: null,
        });
      });

      it('answers mergeStateStatus BLOCKED, for a bypass actor too, and CLEAN once met', async () => {
        const { base, number } = await pullRequest();
        await requireOn(
          base,
          { required_approving_review_count: 1 },
          maintainers,
        );
        expect(await pullFields(author, number)).toMatchObject({
          mergeable: 'MERGEABLE',
          mergeStateStatus: 'BLOCKED',
        });
        expect(await pullFields(maintainer, number)).toMatchObject({
          mergeStateStatus: 'BLOCKED',
        });

        await review(reviewer, number, 'approved');
        expect(await pullFields(author, number)).toMatchObject({
          mergeStateStatus: 'CLEAN',
        });
      });

      it('keeps DRAFT ahead of BLOCKED', async () => {
        const { base, number } = await pullRequest();
        await requireOn(base, { required_approving_review_count: 1 });
        await http()
          .post(`/api/repositories/${repo}/pulls/${number}/draft`)
          .set('cookie', author.cookie)
          .expect(201);
        expect(await pullFields(author, number)).toMatchObject({
          mergeStateStatus: 'DRAFT',
        });
      });

      it('refuses mergePullRequest with an error listing every unmet requirement', async () => {
        const { base, head, number } = await pullRequest();
        const approvals = await requireOn(base, {
          required_approving_review_count: 1,
        });
        const threads = await requireOn(base, {
          required_review_thread_resolution: true,
        });
        await thread(reviewer, number, head);
        const { id } = await pullFields(author, number);

        const body = await mergeMutation(author, id);
        expect(body.errors).toHaveLength(1);
        expect(body.errors[0].message).toContain(approvals.name);
        expect(body.errors[0].message).toContain(threads.name);
        expect(await pullFields(author, number)).toMatchObject({
          state: 'OPEN',
        });
      });

      it('merges through mergePullRequest for a bypass actor without any flag', async () => {
        const { base, number } = await pullRequest();
        await requireOn(
          base,
          { required_approving_review_count: 1 },
          maintainers,
        );
        const { id } = await pullFields(maintainer, number);

        const body = await mergeMutation(maintainer, id);
        expect(body.errors).toBeUndefined();
        expect(body.data.mergePullRequest.pullRequest).toEqual({
          state: 'MERGED',
          merged: true,
        });
      });

      it('lists repository.rulesets matching the REST ruleset, with bypass actors for admins only', async () => {
        const made = await requireOn(
          `listed-${++counter}`,
          {
            required_approving_review_count: 2,
            require_code_owner_review: true,
            allowed_merge_methods: ['squash'],
          },
          maintainers,
        );
        const restRuleset = (
          await rest(owner).get('/rulesets').expect(200)
        ).body.find((ruleset: { name: string }) => ruleset.name === made.name);

        const query = `query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          rulesets(first: 100) {
            nodes {
              databaseId name target enforcement
              conditions { refName { include exclude } }
              rules(first: 10) {
                nodes {
                  type
                  parameters {
                    ... on PullRequestParameters {
                      requiredApprovingReviewCount dismissStaleReviewsOnPush requireCodeOwnerReview
                      requireLastPushApproval requiredReviewThreadResolution allowedMergeMethods
                    }
                  }
                }
              }
              bypassActors(first: 10) { nodes { bypassMode repositoryRoleDatabaseId organizationAdmin } }
            }
          }
        }
      }`;
        const asAdmin = await graphql(owner, query, { owner: org, name });
        expect(asAdmin.errors).toBeUndefined();
        const node = asAdmin.data.repository.rulesets.nodes.find(
          (ruleset: { databaseId: number }) =>
            ruleset.databaseId === restRuleset.id,
        );
        expect(node).toEqual({
          databaseId: restRuleset.id,
          name: made.name,
          target: 'BRANCH',
          enforcement: 'ACTIVE',
          conditions: { refName: { include: made.include, exclude: [] } },
          rules: {
            nodes: [
              {
                type: 'PULL_REQUEST',
                parameters: {
                  requiredApprovingReviewCount: 2,
                  dismissStaleReviewsOnPush: false,
                  requireCodeOwnerReview: true,
                  requireLastPushApproval: false,
                  requiredReviewThreadResolution: false,
                  allowedMergeMethods: ['SQUASH'],
                },
              },
            ],
          },
          bypassActors: {
            nodes: [
              {
                bypassMode: 'ALWAYS',
                repositoryRoleDatabaseId: 2,
                organizationAdmin: false,
              },
            ],
          },
        });

        const asWriter = await graphql(author, query, { owner: org, name });
        const seen = asWriter.data?.repository?.rulesets.nodes.find(
          (ruleset: { databaseId: number }) =>
            ruleset.databaseId === restRuleset.id,
        );
        expect(seen).toMatchObject({ name: made.name });
        expect(seen.bypassActors?.nodes ?? []).toEqual([]);
      });
    });

    describe('required status checks', () => {
      const checksOn = (base: string, strict = false) =>
        http()
          .post(`/api/repositories/${repo}/rulesets`)
          .set('cookie', owner.cookie)
          .send({
            name: `${base} checks ${++counter}`,
            target: 'branch',
            enforcement: 'active',
            include: [base],
            exclude: [],
            bypassActors: [],
            rules: [
              {
                type: 'required_status_checks',
                parameters: {
                  required_status_checks: [{ context: 'build' }],
                  strict_required_status_checks_policy: strict,
                },
              },
            ],
          })
          .expect(201);
      const status = (sha: string, state: string, context = 'build') =>
        http()
          .post(`/api/repositories/${repo}/statuses/${sha}`)
          .set('cookie', owner.cookie)
          .send({ state, context })
          .expect(201);
      const states = async (number: number) => [
        (await pullFields(author, number)).mergeStateStatus,
        (await rest(author).get(`/pulls/${number}`).expect(200)).body
          .mergeable_state,
      ];

      it('is BLOCKED while a required check is missing, UNSTABLE with a failing optional one, and CLEAN once met', async () => {
        const { base, head, number } = await pullRequest();
        await checksOn(base);
        const sha = git('rev-parse', head);
        expect(await states(number)).toEqual(['BLOCKED', 'blocked']);

        await status(sha, 'success');
        await status(sha, 'failure', 'lint');
        expect(await states(number)).toEqual(['UNSTABLE', 'unstable']);

        await status(sha, 'success', 'lint');
        expect(await states(number)).toEqual(['CLEAN', 'clean']);
      });

      it('is BEHIND when only strict is unmet', async () => {
        const { base, head, number } = await pullRequest();
        git('checkout', '-q', base);
        writeFileSync(path.join(work, `${base}-moved.txt`), 'moved\n');
        git('add', '-A');
        git('commit', '-q', '-m', 'move the base');
        await pushAs(owner, `${base}:refs/heads/${base}`);
        await checksOn(base, true);
        await status(git('rev-parse', head), 'success');
        expect(await states(number)).toEqual(['BEHIND', 'behind']);
      });

      it("answers isRequired only for a pull request in the status's own repository", async () => {
        const { head, number } = await pullRequest();
        const sha = git('rev-parse', head);
        await status(sha, 'success');

        // A private repository the author cannot read, whose pull request requires the same context.
        await http()
          .post('/api/repositories')
          .set('cookie', owner.cookie)
          .send({ name: 'hidden', visibility: 'private' })
          .expect(201);
        const hidden = `${owner.username}/hidden`;
        git('checkout', '-q', '-B', 'hidden-main', 'main');
        await promisify(execFile)(
          'git',
          [
            'push',
            '-q',
            `${origin.replace('://', `://${owner.username}:${owner.key}@`)}/${hidden}.git`,
            'hidden-main:refs/heads/main',
            `${head}:refs/heads/hidden-head`,
          ],
          { cwd: work, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
        );
        const hiddenPull = (
          await http()
            .post(`/api/repositories/${hidden}/pulls`)
            .set('cookie', owner.cookie)
            .send({ title: 'hidden', base: 'main', head: 'hidden-head' })
            .expect(201)
        ).body.number as number;
        await http()
          .post(`/api/repositories/${hidden}/rulesets`)
          .set('cookie', owner.cookie)
          .send({
            name: 'hidden checks',
            target: 'branch',
            enforcement: 'active',
            include: ['main'],
            exclude: [],
            bypassActors: [],
            rules: [
              {
                type: 'required_status_checks',
                parameters: { required_status_checks: [{ context: 'build' }] },
              },
            ],
          })
          .expect(201);
        const hiddenId = (
          await graphql(
            owner,
            `query($owner: String!, $number: Int!) { repository(owner: $owner, name: "hidden") { pullRequest(number: $number) { id } } }`,
            { owner: owner.username, number: hiddenPull },
          )
        ).data.repository.pullRequest.id;

        const body = await graphql(
          author,
          `query($owner: String!, $name: String!, $number: Int!, $other: ID!) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 10) { nodes {
                ... on StatusContext { context isRequired(pullRequestId: $other) }
              } } } } } }
            }
          }
        }`,
          { owner: org, name, number, other: hiddenId },
        );
        expect(body.errors).toBeUndefined();
        expect(
          body.data.repository.pullRequest.commits.nodes[0].commit
            .statusCheckRollup.contexts.nodes,
        ).toEqual([{ context: 'build', isRequired: false }]);
      });

      it('marks the required contexts with isRequired', async () => {
        const { base, head, number } = await pullRequest();
        await checksOn(base);
        const sha = git('rev-parse', head);
        await status(sha, 'success');
        await status(sha, 'success', 'lint');
        const body = await graphql(
          author,
          `query($owner: String!, $name: String!, $number: Int!) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              id
              commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 10) { nodes {
                ... on StatusContext { context isRequired(pullRequestNumber: $number) }
              } } } } } }
            }
          }
        }`,
          { owner: org, name, number },
        );
        expect(body.errors).toBeUndefined();
        const contexts =
          body.data.repository.pullRequest.commits.nodes[0].commit
            .statusCheckRollup.contexts.nodes;
        expect(
          contexts
            .map(
              ({
                context,
                isRequired,
              }: {
                context: string;
                isRequired: boolean;
              }) => [context, isRequired],
            )
            .sort(),
        ).toEqual([
          ['build', true],
          ['lint', false],
        ]);

        const byId = await graphql(
          author,
          `query($id: ID!) { node(id: $id) { ... on PullRequest { commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 10) { nodes { ... on StatusContext { context isRequired(pullRequestId: $id) } } } } } } } } } }`,
          { id: body.data.repository.pullRequest.id },
        );
        expect(byId.errors).toBeUndefined();
        expect(
          byId.data.node.commits.nodes[0].commit.statusCheckRollup.contexts.nodes.find(
            ({ context }: { context: string }) => context === 'build',
          ).isRequired,
        ).toBe(true);
      });
    });
  },
);
