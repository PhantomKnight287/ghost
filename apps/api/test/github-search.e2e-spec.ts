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
import { hasBackends, scopedKey, signUp, startApp } from './harness.js';

type Account = { cookie: string; key: string; userId: string };

describe.skipIf(!hasBackends)('GitHub issue search across repositories', () => {
  let app: INestApplication;
  let origin: string;
  let owner: Account;
  let stranger: Account;
  let work: string;
  const username = `ghsearch${Date.now()}`;
  const org = `${username}o`;
  const strangerName = `${username}s`;
  const api = () => request(app.getHttpServer());

  const SEARCH =
    'query($q: String!, $first: Int, $after: String) { search(type: ISSUE, first: $first, after: $after, query: $q) { issueCount nodes { ...on Issue { title repository { nameWithOwner } } ...on PullRequest { title repository { nameWithOwner } } } pageInfo { hasNextPage endCursor } } }';
  const search = async (
    q: string,
    token?: string,
    paging: { first?: number; after?: string } = {},
  ) => {
    const call = api()
      .post('/api/graphql')
      .send({ query: SEARCH, variables: { q, first: 30, ...paging } });
    const response = await (token
      ? call.set('authorization', `token ${token}`)
      : call
    ).expect(200);
    expect(response.body.errors).toBeUndefined();
    return response.body.data.search as {
      issueCount: number;
      nodes: { title: string; repository: { nameWithOwner: string } }[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
  const titles = (result: { nodes: { title: string }[] }) =>
    result.nodes.map((node) => node.title).sort();
  const rest = (query: string, token?: string) => {
    const call = api().get(`/api/v3/search/issues?${query}`);
    return token ? call.set('authorization', `token ${token}`) : call;
  };
  const createRepository = (
    account: Account,
    name: string,
    visibility: 'public' | 'private',
    organization?: string,
  ) =>
    api()
      .post('/api/repositories')
      .set('cookie', account.cookie)
      .send({ name, visibility, organization })
      .expect(201);
  const createIssue = (
    account: Account,
    repository: string,
    title: string,
    labels: string[] = [],
  ) =>
    api()
      .post(`/api/repositories/${repository}/issues`)
      .set('cookie', account.cookie)
      .send({ title, labels })
      .expect(201);

  beforeAll(async () => {
    ({ app, origin } = await startApp());
    owner = await signUp(app, username);
    stranger = await signUp(app, strangerName);
    await createRepository(owner, 'alpha', 'public');
    await createRepository(owner, 'beta', 'private');
    await app.get<AuthService<Auth>>(AuthService).api.createOrganization({
      body: { name: 'Search Org', slug: org },
      headers: new Headers({ cookie: owner.cookie }),
    });
    await createRepository(owner, 'gamma', 'public', org);
    await createRepository(stranger, 'side', 'public');
    await api()
      .post(`/api/repositories/${username}/alpha/labels`)
      .set('cookie', owner.cookie)
      .send({ name: 'bug', color: 'd73a4a' })
      .expect(201);
    await api()
      .post(`/api/repositories/${org}/gamma/labels`)
      .set('cookie', owner.cookie)
      .send({ name: 'Bug', color: 'd73a4a' })
      .expect(201);
    await createIssue(owner, `${username}/alpha`, 'Broken build', ['bug']);
    await createIssue(owner, `${username}/alpha`, 'Docs typo');
    await createIssue(owner, `${username}/beta`, 'Broken build in secret');
    await createIssue(owner, `${org}/gamma`, 'Broken build in org', ['Bug']);
    await createIssue(
      stranger,
      `${strangerName}/side`,
      `Broken build elsewhere ${username}`,
    );

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-ghsearch-'));
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
        { cwd: work },
      );
    git('init', '-q', '-b', 'main');
    writeFileSync(path.join(work, 'a.txt'), 'one\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    git('checkout', '-q', '-b', 'fix');
    writeFileSync(path.join(work, 'a.txt'), 'two\n');
    git('commit', '-q', '-am', 'second');
    // The server runs in this process, so the push must not block the event loop.
    await promisify(execFile)(
      'git',
      [
        'push',
        '-q',
        `${origin.replace('://', `://${username}:${owner.key}@`)}/${username}/alpha.git`,
        'main',
        'fix',
      ],
      { cwd: work, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
    await api()
      .post(`/api/repositories/${username}/alpha/pulls`)
      .set('cookie', owner.cookie)
      .send({ title: 'Broken build fix', base: 'main', head: 'fix' })
      .expect(201);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  describe('GraphQL search', () => {
    it("finds issues and pull requests in every repository of a user's that the viewer can read", async () => {
      const result = await search(`user:${username} build`, owner.key);
      expect(titles(result)).toEqual([
        'Broken build',
        'Broken build fix',
        'Broken build in secret',
      ]);
      expect(result.issueCount).toBe(3);
      expect(
        result.nodes.find((node) => node.title === 'Broken build in secret')
          ?.repository.nameWithOwner,
      ).toBe(`${username}/beta`);
    });

    it('reads repeated user:, org: and repo: qualifiers as any of them', async () => {
      expect(
        titles(
          await search(`user:${username} org:${org} build is:issue`, owner.key),
        ),
      ).toEqual([
        'Broken build',
        'Broken build in org',
        'Broken build in secret',
      ]);
      expect(
        titles(
          await search(
            `repo:${username}/beta repo:${org}/gamma build`,
            owner.key,
          ),
        ),
      ).toEqual(['Broken build in org', 'Broken build in secret']);
    });

    it('narrows to pull requests, a label in any case, and the visibility asked for', async () => {
      expect(titles(await search(`user:${username} is:pr`, owner.key))).toEqual(
        ['Broken build fix'],
      );
      expect(
        titles(
          await search(`user:${username} org:${org} label:bug`, owner.key),
        ),
      ).toEqual(['Broken build', 'Broken build in org']);
      expect(
        titles(await search(`user:${username} is:private`, owner.key)),
      ).toEqual(['Broken build in secret']);
      expect(
        titles(await search(`repo:${username}/alpha is:private`, owner.key)),
      ).toEqual([]);
      expect(
        titles(
          await search(
            `user:${username} org:${org} is:public build is:issue`,
            owner.key,
          ),
        ),
      ).toEqual(['Broken build', 'Broken build in org']);
    });

    it('finds only public repositories anonymously, for a stranger, and for a token without repo', async () => {
      const expected = ['Broken build', 'Broken build fix'];
      expect(titles(await search(`user:${username} build`))).toEqual(expected);
      expect(
        titles(await search(`user:${username} build`, stranger.key)),
      ).toEqual(expected);
      expect(
        titles(
          await search(
            `user:${username} build`,
            await scopedKey(app, owner.userId, ['public_repo']),
          ),
        ),
      ).toEqual(expected);
      expect(
        titles(
          await search(
            `user:${username} build`,
            await scopedKey(app, owner.userId, ['repo']),
          ),
        ),
      ).toEqual([...expected, 'Broken build in secret']);
    });

    it('searches every readable repository when the query names none', async () => {
      const everywhere = await search(
        `"Broken build elsewhere ${username}"`,
        owner.key,
      );
      expect(everywhere.nodes).toEqual([
        {
          title: `Broken build elsewhere ${username}`,
          repository: { nameWithOwner: `${strangerName}/side` },
        },
      ]);
    });

    it('pages with the cursor it answers, newest first', async () => {
      const first = await search(`user:${username} build`, owner.key, {
        first: 2,
      });
      expect(first.issueCount).toBe(3);
      expect(first.nodes.map((node) => node.title)).toEqual([
        'Broken build fix',
        'Broken build in secret',
      ]);
      expect(first.pageInfo.hasNextPage).toBe(true);
      const second = await search(`user:${username} build`, owner.key, {
        first: 2,
        after: first.pageInfo.endCursor!,
      });
      expect(second.nodes.map((node) => node.title)).toEqual(['Broken build']);
      expect(second.pageInfo.hasNextPage).toBe(false);
    });

    it('finds nothing for an owner that does not exist', async () => {
      const result = await search(`user:${username}-missing build`, owner.key);
      expect(result).toMatchObject({ issueCount: 0, nodes: [] });
    });
  });

  describe('REST GET /search/issues', () => {
    it('answers total_count, incomplete_results and items in the issue shape, paged with Link', async () => {
      const response = await rest(
        `q=${encodeURIComponent(`user:${username} build`)}&per_page=2`,
        owner.key,
      ).expect(200);
      expect(response.body.total_count).toBe(3);
      expect(response.body.incomplete_results).toBe(false);
      expect(response.body.items).toHaveLength(2);
      const [pull, secret] = response.body.items;
      expect(pull).toMatchObject({
        title: 'Broken build fix',
        repository_url: expect.stringMatching(
          new RegExp(`/api/v3/repos/${username}/alpha$`),
        ),
        pull_request: expect.objectContaining({
          html_url: expect.stringContaining(`/${username}/alpha/pull/`),
        }),
      });
      expect(secret).toMatchObject({
        title: 'Broken build in secret',
        repository_url: expect.stringMatching(
          new RegExp(`/api/v3/repos/${username}/beta$`),
        ),
      });
      expect(response.headers.link).toContain('rel="next"');
      const next = await rest(
        `q=${encodeURIComponent(`user:${username} build`)}&per_page=2&page=2`,
        owner.key,
      ).expect(200);
      expect(
        next.body.items.map((item: { title: string }) => item.title),
      ).toEqual(['Broken build']);
    });

    it('sorts by created ascending when asked', async () => {
      const response = await rest(
        `q=${encodeURIComponent(`user:${username} build`)}&sort=created&order=asc`,
        owner.key,
      ).expect(200);
      expect(
        response.body.items.map((item: { title: string }) => item.title),
      ).toEqual(['Broken build', 'Broken build in secret', 'Broken build fix']);
    });

    it('sorts by comments or updated, and newest first for a sort Ghost cannot apply', async () => {
      await api()
        .post(`/api/repositories/${username}/alpha/issues/1/comments`)
        .set('cookie', owner.cookie)
        .send({ body: 'Still broken' })
        .expect(201);
      const sorted = async (sort: string) =>
        (
          await rest(
            `q=${encodeURIComponent(`user:${username} build is:issue`)}&${sort}`,
            owner.key,
          ).expect(200)
        ).body.items.map((item: { title: string }) => item.title);
      const commentedFirst = ['Broken build', 'Broken build in secret'];
      expect(await sorted('sort=comments')).toEqual(commentedFirst);
      expect(await sorted('sort=updated')).toEqual(commentedFirst);
      expect(await sorted('sort=comments&order=asc')).toEqual(
        [...commentedFirst].reverse(),
      );
      expect(await sorted('sort=reactions')).toEqual(
        [...commentedFirst].reverse(),
      );
    });

    it('answers anonymously with public repositories only', async () => {
      const response = await rest(
        `q=${encodeURIComponent(`user:${username} build`)}`,
      ).expect(200);
      expect(response.body.total_count).toBe(2);
    });

    it('refuses a search without q with 422', async () => {
      await rest('per_page=1', owner.key).expect(422);
    });
  });
});
