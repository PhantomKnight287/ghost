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

const REJECTED = /push declined due to repository rule violations/;
const violationsFor = (ref: string) =>
  new RegExp(
    `GH013: Repository rule violations found for ${ref.replaceAll('/', '\\/')}`,
  );

/** Every user write to a targeted ref goes through the rulesets: git pushes and each API path that moves a ref. */
describe.skipIf(!hasBackends)('ruleset enforcement', () => {
  let app: INestApplication;
  let origin: string;
  let owner: Account;
  let writer: Account;
  let maintainer: Account;
  let teammate: Account;
  let orgAdmin: Account;
  let teamId: string;
  let work: string;
  const stamp = Date.now();
  const org = `reorg${stamp}`;
  const repo = `${org}/guarded`;
  let counter = 0;

  const api = () => request(app.getHttpServer());
  const auth = () => app.get<AuthService<Auth>>(AuthService).api;
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
  const serverTip = async (ref: string) => {
    const { stdout } = await promisify(execFile)(
      'git',
      ['ls-remote', remote(owner), ref],
      { cwd: work, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
    return stdout.split('\t')[0] || null;
  };
  /** A new commit on `branch`, started from `from`; returns its sha and leaves it checked out. */
  const commitOn = (branch: string, from: string) => {
    git('checkout', '-q', '-B', branch, from);
    writeFileSync(path.join(work, `${branch.replaceAll('/', '-')}.txt`), `${++counter}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', `commit ${counter} on ${branch}`);
    return git('rev-parse', 'HEAD');
  };
  /** A branch on the server at a fresh commit off main, pushed before any ruleset targets it. */
  const seed = async (branch: string) => {
    const sha = commitOn(branch, 'main');
    await pushAs(owner, `${branch}:refs/heads/${branch}`);
    return sha;
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
  const openPull = async (account: Account, head: string, base: string) =>
    (
      await api()
        .post(`/api/repositories/${repo}/pulls`)
        .set('cookie', account.cookie)
        .send({ title: `${head} into ${base}`, base, head })
        .expect(201)
    ).body.number as number;
  const merge = (account: Account, number: number, method = 'squash') =>
    api()
      .post(`/api/repositories/${repo}/pulls/${number}/merge`)
      .set('cookie', account.cookie)
      .send({ method });
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

  beforeAll(async () => {
    ({ app, origin } = await startApp());
    owner = await account(`reowner${stamp}`);
    writer = await account(`rewriter${stamp}`);
    maintainer = await account(`remaint${stamp}`);
    teammate = await account(`reteam${stamp}`);
    orgAdmin = await account(`reorgadmin${stamp}`);
    const headers = new Headers({ cookie: owner.cookie });
    const { id: organizationId } = (await auth().createOrganization({
      body: { name: 'Enforced', slug: org },
      headers,
    }))!;
    await auth().addMember({
      body: { userId: teammate.userId, role: 'member', organizationId },
    });
    await auth().addMember({
      body: { userId: orgAdmin.userId, role: 'admin', organizationId },
    });
    teamId = (await auth().createTeam({
      body: { name: 'Core', organizationId },
      headers,
    }))!.id;
    await auth().addTeamMember({
      body: { teamId, userId: teammate.userId, organizationId },
      headers,
    });
    await api()
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: 'guarded', organization: org, visibility: 'public' })
      .expect(201);
    await api()
      .put(`/api/repositories/${repo}/teams/${teamId}`)
      .set('cookie', owner.cookie)
      .send({ role: 'write' })
      .expect(204);
    await collaborate(writer, 'write');
    await collaborate(maintainer, 'maintain');

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-rulesets-enforced-'));
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

  describe('git push', () => {
    it('refuses a force-push under non_fast_forward with GitHub’s message, naming the ruleset, and keeps the ref', async () => {
      const before = await seed('ff-guard');
      await ruleset({
        name: 'no rewrites',
        include: ['ff-guard'],
        rules: [{ type: 'non_fast_forward' }],
      });
      commitOn('ff-guard', 'main');

      const refused = pushAs(writer, '+ff-guard:refs/heads/ff-guard');
      await expect(refused).rejects.toThrow(violationsFor('refs/heads/ff-guard'));
      await expect(refused).rejects.toThrow(/Cannot force-push to this branch/);
      await expect(refused).rejects.toThrow(/no rewrites/);
      await expect(refused).rejects.toThrow(REJECTED);
      expect(await serverTip('refs/heads/ff-guard')).toBe(before);
    });

    it('still takes a fast-forward under non_fast_forward', async () => {
      await seed('ff-ok');
      await ruleset({
        name: 'ff ok',
        include: ['ff-ok'],
        rules: [{ type: 'non_fast_forward' }],
      });
      const next = commitOn('ff-ok', 'ff-ok');
      await pushAs(writer, 'ff-ok:refs/heads/ff-ok');
      expect(await serverTip('refs/heads/ff-ok')).toBe(next);
    });

    it('refuses deleting a ref under deletion', async () => {
      const before = await seed('del-guard');
      await ruleset({
        name: 'keep it',
        include: ['del-guard'],
        rules: [{ type: 'deletion' }],
      });

      const refused = pushAs(writer, ':refs/heads/del-guard');
      await expect(refused).rejects.toThrow(violationsFor('refs/heads/del-guard'));
      await expect(refused).rejects.toThrow(REJECTED);
      expect(await serverTip('refs/heads/del-guard')).toBe(before);
    });

    it('refuses creating a ref under creation, matching `*` within one segment only', async () => {
      await ruleset({
        name: 'no locked',
        include: ['locked/*'],
        rules: [{ type: 'creation' }],
      });
      commitOn('locked-work', 'main');

      await expect(
        pushAs(writer, 'locked-work:refs/heads/locked/a'),
      ).rejects.toThrow(violationsFor('refs/heads/locked/a'));
      expect(await serverTip('refs/heads/locked/a')).toBeNull();

      await pushAs(writer, 'locked-work:refs/heads/locked/a/b');
      expect(await serverTip('refs/heads/locked/a/b')).not.toBeNull();
    });

    it('refuses any move under update, even a fast-forward', async () => {
      const before = await seed('frozen');
      await ruleset({
        name: 'frozen',
        include: ['frozen'],
        rules: [{ type: 'update' }],
      });
      commitOn('frozen', 'frozen');

      await expect(pushAs(writer, 'frozen:refs/heads/frozen')).rejects.toThrow(
        violationsFor('refs/heads/frozen'),
      );
      expect(await serverTip('refs/heads/frozen')).toBe(before);
    });

    it('refuses bringing in a merge commit under required_linear_history, and takes a linear push', async () => {
      const before = await seed('linear');
      await ruleset({
        name: 'straight line',
        include: ['linear'],
        rules: [{ type: 'required_linear_history' }],
      });
      commitOn('linear-side', 'linear');
      commitOn('linear', 'linear');
      git('merge', '-q', '--no-ff', '-m', 'merge side', 'linear-side');

      await expect(pushAs(writer, 'linear:refs/heads/linear')).rejects.toThrow(
        violationsFor('refs/heads/linear'),
      );
      expect(await serverTip('refs/heads/linear')).toBe(before);

      const straight = commitOn('linear', before);
      await pushAs(writer, 'linear:refs/heads/linear');
      expect(await serverTip('refs/heads/linear')).toBe(straight);
    });

    it('refuses fast-forwarding a protected branch onto a merge commit another branch already brought in', async () => {
      const before = await seed('linear-ff');
      await ruleset({
        name: 'straight ff',
        include: ['linear-ff'],
        rules: [{ type: 'required_linear_history' }],
      });
      commitOn('linear-ff-side', 'linear-ff');
      commitOn('linear-ff-feature', 'linear-ff');
      git('merge', '-q', '--no-ff', '-m', 'merge side', 'linear-ff-side');
      await pushAs(writer, 'linear-ff-feature:refs/heads/linear-ff-feature');

      await expect(
        pushAs(writer, 'linear-ff-feature:refs/heads/linear-ff'),
      ).rejects.toThrow(violationsFor('refs/heads/linear-ff'));
      expect(await serverTip('refs/heads/linear-ff')).toBe(before);
    });

    it('refuses creating a branch that already carries a merge commit under required_linear_history', async () => {
      await ruleset({
        name: 'straight new',
        include: ['linear-new/*'],
        rules: [{ type: 'required_linear_history' }],
      });
      commitOn('ln-side', 'main');
      commitOn('ln', 'main');
      git('merge', '-q', '--no-ff', '-m', 'merge side', 'ln-side');

      await expect(pushAs(writer, 'ln:refs/heads/linear-new/one')).rejects.toThrow(
        violationsFor('refs/heads/linear-new/one'),
      );
    });

    it('refuses the whole push when one of its refs is refused', async () => {
      await seed('atomic-guard');
      await ruleset({
        name: 'atomic',
        include: ['atomic-guard'],
        rules: [{ type: 'deletion' }],
      });
      commitOn('atomic-new', 'main');

      await expect(
        pushAs(writer, 'atomic-new:refs/heads/atomic-new', ':refs/heads/atomic-guard'),
      ).rejects.toThrow(REJECTED);
      expect(await serverTip('refs/heads/atomic-new')).toBeNull();
      expect(await serverTip('refs/heads/atomic-guard')).not.toBeNull();
    });

    it('ignores a disabled ruleset', async () => {
      await seed('off');
      await ruleset({
        name: 'off',
        include: ['off'],
        enforcement: 'disabled',
        rules: [{ type: 'deletion' }],
      });
      await pushAs(writer, ':refs/heads/off');
      expect(await serverTip('refs/heads/off')).toBeNull();
    });
  });

  describe('tags', () => {
    it('refuses creating a targeted tag by push and by release, and allows others', async () => {
      await ruleset({
        name: 'versions',
        target: 'tag',
        include: ['v*'],
        rules: [{ type: 'creation' }],
      });
      git('checkout', '-q', 'main');
      git('tag', 'v9');

      await expect(pushAs(writer, 'refs/tags/v9')).rejects.toThrow(
        violationsFor('refs/tags/v9'),
      );
      expect(await serverTip('refs/tags/v9')).toBeNull();

      const refused = await api()
        .post(`/api/repositories/${repo}/releases`)
        .set('cookie', writer.cookie)
        .send({ tagName: 'v10' })
        .expect(422);
      expect(refused.body.message).toContain('versions');
      expect(await serverTip('refs/tags/v10')).toBeNull();

      await api()
        .post(`/api/repositories/${repo}/releases`)
        .set('cookie', writer.cookie)
        .send({ tagName: 'build-1' })
        .expect(201);
    });

    it('refuses deleting a targeted tag', async () => {
      git('checkout', '-q', 'main');
      git('tag', 'keep-1');
      await pushAs(owner, 'refs/tags/keep-1');
      await ruleset({
        name: 'keep tags',
        target: 'tag',
        include: ['keep-*'],
        rules: [{ type: 'deletion' }],
      });

      await expect(pushAs(writer, ':refs/tags/keep-1')).rejects.toThrow(
        violationsFor('refs/tags/keep-1'),
      );
      expect(await serverTip('refs/tags/keep-1')).not.toBeNull();
    });

    it('leaves branches alone under a tag ruleset', async () => {
      await ruleset({
        name: 'tags everywhere',
        target: 'tag',
        include: ['~ALL'],
        rules: [{ type: 'creation' }],
      });
      commitOn('not-a-tag', 'main');
      await pushAs(writer, 'not-a-tag:refs/heads/not-a-tag');
      expect(await serverTip('refs/heads/not-a-tag')).not.toBeNull();
    });
  });

  describe('API writes', () => {
    it('refuses creating a branch through the API under creation', async () => {
      await ruleset({
        name: 'no api locked',
        include: ['api-locked/*'],
        rules: [{ type: 'creation' }],
      });
      const refused = await api()
        .post(`/api/repositories/${repo}/branches`)
        .set('cookie', writer.cookie)
        .send({ name: 'api-locked/one', from: 'main' })
        .expect(422);
      expect(refused.body.message).toContain('no api locked');
      expect(await serverTip('refs/heads/api-locked/one')).toBeNull();

      await api()
        .post(`/api/repositories/${repo}/branches`)
        .set('cookie', writer.cookie)
        .send({ name: 'api-free', from: 'main' })
        .expect(201);
    });

    it('refuses deleting a branch through the API under deletion', async () => {
      await seed('api-del');
      await ruleset({
        name: 'api keep',
        include: ['api-del'],
        rules: [{ type: 'deletion' }],
      });
      const refused = await api()
        .delete(`/api/repositories/${repo}/branches/api-del`)
        .set('cookie', writer.cookie)
        .expect(422);
      expect(refused.body.message).toContain('api keep');
      expect(await serverTip('refs/heads/api-del')).not.toBeNull();
    });

    it('refuses merging a pull request into a ref under update', async () => {
      const before = await seed('merge-frozen');
      await seed('merge-frozen-work');
      const number = await openPull(owner, 'merge-frozen-work', 'merge-frozen');
      await ruleset({
        name: 'merge freeze',
        include: ['merge-frozen'],
        rules: [{ type: 'update' }],
      });

      const refused = await merge(owner, number).expect(422);
      expect(refused.body.message).toContain('merge freeze');
      expect(await serverTip('refs/heads/merge-frozen')).toBe(before);
    });

    it('refuses the merge method under required_linear_history, and takes squash', async () => {
      await seed('merge-linear');
      commitOn('merge-linear-work', 'merge-linear');
      await pushAs(owner, 'merge-linear-work:refs/heads/merge-linear-work');
      const number = await openPull(owner, 'merge-linear-work', 'merge-linear');
      await ruleset({
        name: 'merge line',
        include: ['merge-linear'],
        rules: [{ type: 'required_linear_history' }],
      });

      await merge(owner, number, 'merge').expect(422);
      await merge(owner, number, 'squash').expect(201);
    });

    it('refuses applying a suggestion to a head branch under update', async () => {
      git('checkout', '-q', '-B', 'suggest-head', 'main');
      writeFileSync(path.join(work, 'suggest.txt'), 'one\ntwo\n');
      git('add', '-A');
      git('commit', '-q', '-m', 'to suggest on');
      const before = git('rev-parse', 'HEAD');
      await pushAs(owner, 'suggest-head:refs/heads/suggest-head');
      const number = await openPull(owner, 'suggest-head', 'main');
      const { body } = await api()
        .post(`/api/repositories/${repo}/pulls/${number}/reviews`)
        .set('cookie', writer.cookie)
        .send({
          state: 'commented',
          comments: [
            {
              path: 'suggest.txt',
              side: 'additions',
              line: 2,
              body: '```suggestion\nTWO\n```',
            },
          ],
        })
        .expect(201);
      await ruleset({
        name: 'suggest freeze',
        include: ['suggest-head'],
        rules: [{ type: 'update' }],
      });

      const refused = await api()
        .post(`/api/repositories/${repo}/pulls/${number}/comments/${body.comments[0].id}/apply`)
        .set('cookie', owner.cookie)
        .expect(422);
      expect(refused.body.message).toContain('suggest freeze');
      expect(await serverTip('refs/heads/suggest-head')).toBe(before);
    });
  });

  describe('bypass', () => {
    it('lets a listed repository role through, and nobody below it', async () => {
      await seed('bp-role');
      await ruleset({
        name: 'maintainers may',
        include: ['bp-role'],
        rules: [{ type: 'non_fast_forward' }],
        bypassActors: [
          { actorType: 'RepositoryRole', role: 'maintain', bypassMode: 'always' },
        ],
      });
      const rewritten = commitOn('bp-role', 'main');

      await expect(pushAs(writer, '+bp-role:refs/heads/bp-role')).rejects.toThrow(
        violationsFor('refs/heads/bp-role'),
      );
      await pushAs(maintainer, '+bp-role:refs/heads/bp-role');
      expect(await serverTip('refs/heads/bp-role')).toBe(rewritten);
    });

    it('lets members of a listed team through', async () => {
      await seed('bp-team');
      await ruleset({
        name: 'core may',
        include: ['bp-team'],
        rules: [{ type: 'deletion' }],
        bypassActors: [{ actorType: 'Team', teamId, bypassMode: 'always' }],
      });

      await expect(pushAs(writer, ':refs/heads/bp-team')).rejects.toThrow(REJECTED);
      await pushAs(teammate, ':refs/heads/bp-team');
      expect(await serverTip('refs/heads/bp-team')).toBeNull();
    });

    it('lets organization admins through when listed', async () => {
      await seed('bp-org');
      await ruleset({
        name: 'org admins may',
        include: ['bp-org'],
        rules: [{ type: 'deletion' }],
        bypassActors: [{ actorType: 'OrganizationAdmin', bypassMode: 'always' }],
      });
      await pushAs(orgAdmin, ':refs/heads/bp-org');
      expect(await serverTip('refs/heads/bp-org')).toBeNull();
    });

    it('holds the owner to a ruleset that does not list them', async () => {
      const before = await seed('bp-none');
      await ruleset({
        name: 'everyone',
        include: ['bp-none'],
        rules: [{ type: 'deletion' }],
      });
      await expect(pushAs(owner, ':refs/heads/bp-none')).rejects.toThrow(REJECTED);
      expect(await serverTip('refs/heads/bp-none')).toBe(before);
    });

    it('pull_request mode lets the actor merge but not push', async () => {
      const before = await seed('bp-pr');
      commitOn('bp-pr-work', 'bp-pr');
      await pushAs(writer, 'bp-pr-work:refs/heads/bp-pr-work');
      const number = await openPull(writer, 'bp-pr-work', 'bp-pr');
      await ruleset({
        name: 'via pull requests',
        include: ['bp-pr'],
        rules: [{ type: 'update' }],
        bypassActors: [
          { actorType: 'RepositoryRole', role: 'write', bypassMode: 'pull_request' },
        ],
      });

      commitOn('bp-pr', 'bp-pr');
      await expect(pushAs(writer, 'bp-pr:refs/heads/bp-pr')).rejects.toThrow(REJECTED);
      expect(await serverTip('refs/heads/bp-pr')).toBe(before);

      await merge(writer, number).expect(201);
      expect(await serverTip('refs/heads/bp-pr')).not.toBe(before);
    });

    it('bypassing one ruleset leaves another in force, and the message names only the one that refused', async () => {
      await seed('layered');
      await ruleset({
        name: 'layer one',
        include: ['layered'],
        rules: [{ type: 'deletion' }],
        bypassActors: [
          { actorType: 'RepositoryRole', role: 'write', bypassMode: 'always' },
        ],
      });
      await ruleset({
        name: 'layer two',
        include: ['layered'],
        rules: [{ type: 'deletion' }],
      });

      const failure = await pushAs(writer, ':refs/heads/layered').then(
        () => null,
        (error: Error) => error.message,
      );
      expect(failure).toMatch(/layer two/);
      expect(failure).not.toMatch(/layer one/);
    });
  });

  describe('~DEFAULT_BRANCH', () => {
    it('follows the default branch when it changes', async () => {
      await seed('trunk');
      await ruleset({
        name: 'default',
        include: ['~DEFAULT_BRANCH'],
        rules: [{ type: 'non_fast_forward' }],
      });
      const mainTip = git('rev-parse', 'main');
      git('checkout', '-q', '-B', 'rewrite', 'main');
      git('commit', '-q', '--amend', '-m', 'rewritten main');

      await expect(pushAs(writer, '+rewrite:refs/heads/main')).rejects.toThrow(
        violationsFor('refs/heads/main'),
      );
      expect(await serverTip('refs/heads/main')).toBe(mainTip);

      await api()
        .patch(`/api/repositories/${repo}`)
        .set('cookie', owner.cookie)
        .send({ defaultBranch: 'trunk' })
        .expect(200);

      await pushAs(writer, '+rewrite:refs/heads/main');
      expect(await serverTip('refs/heads/main')).toBe(git('rev-parse', 'rewrite'));
      commitOn('trunk-rewrite', 'main');
      await expect(pushAs(writer, '+trunk-rewrite:refs/heads/trunk')).rejects.toThrow(
        violationsFor('refs/heads/trunk'),
      );
    });
  });
});
