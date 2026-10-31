import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, scopedKey, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)(
  'GitHub REST v3 issues, comments and labels',
  () => {
    let app: INestApplication;
    let work: string;
    let owner: { cookie: string; key: string; userId: string };
    let stranger: { cookie: string; key: string; userId: string };
    let pullRequestNumber: number;
    const username = `ghissues${Date.now()}`;
    const repo = `/repos/${username}/public-repo`;
    const v3 = () => request(app.getHttpServer());
    const as = (call: request.Test, token?: string) =>
      token ? call.set('authorization', `token ${token}`) : call;
    const get = (path: string, token?: string) =>
      as(v3().get(`/api/v3${path}`), token);
    const send = (
      method: 'post' | 'patch' | 'put' | 'delete',
      path: string,
      body: unknown,
      token?: string,
    ) => as(v3()[method](`/api/v3${path}`), token).send(body as object);
    /** The page number each `rel` in a Link header points at. */
    const pagesIn = (link: string) =>
      Object.fromEntries(
        [...link.matchAll(/<([^>]+)>; rel="(\w+)"/g)].map(([, url, rel]) => [
          rel,
          Number(new URL(url).searchParams.get('page')),
        ]),
      );
    const openIssue = async (title: string, extra: object = {}) =>
      (
        await send(
          'post',
          `${repo}/issues`,
          { title, ...extra },
          owner.key,
        ).expect(201)
      ).body;

    beforeAll(async () => {
      let origin: string;
      ({ app, origin } = await startApp());
      owner = await signUp(app, username);
      stranger = await signUp(app, `${username}x`);
      const api = v3();
      for (const [name, visibility] of [
        ['public-repo', 'public'],
        ['secret-repo', 'private'],
      ])
        await api
          .post('/api/repositories')
          .set('cookie', owner.cookie)
          .send({ name, visibility })
          .expect(201);

      // One real pull request, so the issue list has one to mark.
      work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-ghissues-'));
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
      git('checkout', '-q', '-b', 'feature');
      writeFileSync(path.join(work, 'a.txt'), 'two\n');
      git('commit', '-q', '-am', 'second');
      // The server runs in this process, so the push must not block the event loop.
      await promisify(execFile)(
        'git',
        [
          'push',
          '-q',
          `${origin.replace('://', `://${username}:${owner.key}@`)}/${username}/public-repo.git`,
          'main',
          'feature',
        ],
        { cwd: work, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      );
      const pull = await api
        .post(`/api/repositories/${username}/public-repo/pulls`)
        .set('cookie', owner.cookie)
        .send({ title: 'Feature', base: 'main', head: 'feature' })
        .expect(201);
      pullRequestNumber = pull.body.number;
    }, 120_000);

    afterAll(async () => {
      await app?.close();
      if (work) rmSync(work, { recursive: true, force: true });
    });

    describe('issues', () => {
      it('opens an issue with integer ids, creating the labels it names', async () => {
        const response = await send(
          'post',
          `${repo}/issues`,
          {
            title: 42,
            body: 'It broke',
            labels: ['fresh-label'],
            assignees: [username],
          },
          owner.key,
        ).expect(201);
        const issue = response.body;
        expect(response.headers.location).toBe(issue.url);
        expect(issue).toMatchObject({
          id: expect.any(Number),
          title: '42',
          state: 'open',
          state_reason: null,
          user: { login: username, id: expect.any(Number), type: 'User' },
          assignee: { login: username },
          assignees: [{ login: username }],
          labels: [
            {
              id: expect.any(Number),
              name: 'fresh-label',
              color: 'ededed',
              description: null,
              default: false,
            },
          ],
          locked: false,
          milestone: null,
          comments: 0,
          author_association: 'OWNER',
        });
        expect(issue.node_id).toMatch(/^I_/);
        expect(issue).not.toHaveProperty('pull_request');

        const graphql = await v3()
          .post('/api/graphql')
          .set('authorization', `token ${owner.key}`)
          .send({
            query: `query { repository(owner: "${username}", name: "public-repo") { issue(number: ${issue.number}) { databaseId } } }`,
          })
          .expect(200);
        expect(graphql.body.data.repository.issue.databaseId).toBe(issue.id);
      });

      it('drops labels and assignees from someone who cannot triage, as GitHub does', async () => {
        const issue = (
          await send(
            'post',
            `${repo}/issues`,
            {
              title: 'From outside',
              labels: ['outsider-label'],
              assignees: [username],
            },
            stranger.key,
          ).expect(201)
        ).body;
        expect(issue.labels).toEqual([]);
        expect(issue.assignees).toEqual([]);
        await get(`${repo}/labels/outsider-label`, owner.key).expect(404);
      });

      it('refuses anonymous writes and hides a private repository from tokens without repo', async () => {
        await send('post', `${repo}/issues`, { title: 'Anonymous' }).expect(
          401,
        );
        await get(`/repos/${username}/secret-repo/issues`).expect(404);
        const publicOnly = await scopedKey(app, owner.userId, ['public_repo']);
        await get(`/repos/${username}/secret-repo/issues`, publicOnly).expect(
          404,
        );
        await get(`/repos/${username}/secret-repo/issues`, owner.key).expect(
          200,
        );
      });

      it('lists pull requests alongside issues, marked as GitHub marks them', async () => {
        const { body } = await get(
          `${repo}/issues?state=all&per_page=100`,
        ).expect(200);
        const pull = body.find(
          (issue: { number: number }) => issue.number === pullRequestNumber,
        );
        expect(pull).toMatchObject({
          draft: false,
          pull_request: {
            url: expect.stringMatching(
              new RegExp(`/pulls/${pullRequestNumber}$`),
            ),
            html_url: expect.stringMatching(
              new RegExp(`/pull/${pullRequestNumber}$`),
            ),
            merged_at: null,
          },
        });
        expect(pull.node_id).toMatch(/^PR_/);
      });

      it('pages with page and per_page and links every page in Link', async () => {
        for (let i = 0; i < 12; i++) await openIssue(`Page filler ${i}`);
        const first = await get(`${repo}/issues?per_page=5`).expect(200);
        expect(first.body).toHaveLength(5);
        const firstLinks = pagesIn(first.headers.link);
        expect(firstLinks.next).toBe(2);
        expect(firstLinks.last).toBeGreaterThanOrEqual(3);
        expect(firstLinks).not.toHaveProperty('prev');

        const second = await get(`${repo}/issues?per_page=5&page=2`).expect(
          200,
        );
        expect(pagesIn(second.headers.link)).toMatchObject({
          prev: 1,
          first: 1,
          next: 3,
        });
        expect(second.body[0].number).toBeLessThan(first.body[4].number);

        const capped = await get(`${repo}/issues?per_page=500`).expect(200);
        expect(capped.headers.link).toBeUndefined();
      });

      it('filters by creator, assignee and since', async () => {
        const byStranger = await get(
          `${repo}/issues?creator=${username}x`,
        ).expect(200);
        expect(
          byStranger.body.map((issue: { title: string }) => issue.title),
        ).toEqual(['From outside']);
        const assigned = await get(`${repo}/issues?assignee=*`).expect(200);
        expect(
          assigned.body.every(
            (issue: { assignees: unknown[] }) => issue.assignees.length > 0,
          ),
        ).toBe(true);
        const unassigned = await get(
          `${repo}/issues?assignee=none&per_page=100`,
        ).expect(200);
        expect(
          unassigned.body.every(
            (issue: { assignees: unknown[] }) => issue.assignees.length === 0,
          ),
        ).toBe(true);
        const future = await get(
          `${repo}/issues?since=2999-01-01T00:00:00Z`,
        ).expect(200);
        expect(future.body).toEqual([]);
      });

      it('closes an already closed issue without complaint and refuses a milestone', async () => {
        const issue = await openIssue('Close me twice');
        for (let i = 0; i < 2; i++) {
          const closed = await send(
            'patch',
            `${repo}/issues/${issue.number}`,
            { state: 'closed', state_reason: 'not_planned' },
            owner.key,
          ).expect(200);
          expect(closed.body).toMatchObject({
            state: 'closed',
            state_reason: 'completed',
            closed_by: { login: username },
          });
        }
        const refused = await send(
          'patch',
          `${repo}/issues/${issue.number}`,
          { milestone: 1 },
          owner.key,
        ).expect(422);
        expect(refused.body.errors).toEqual([
          { resource: 'Issue', field: 'milestone', code: 'invalid' },
        ]);
      });

      it('edits title, body, labels and assignees in one PATCH', async () => {
        const issue = await openIssue('Before');
        const { body } = await send(
          'patch',
          `${repo}/issues/${issue.number}`,
          {
            title: 'After',
            body: 'Now with detail',
            labels: [{ name: 'patched' }],
            assignee: username,
          },
          owner.key,
        ).expect(200);
        expect(body).toMatchObject({
          title: 'After',
          body: 'Now with detail',
          labels: [{ name: 'patched' }],
          assignees: [{ login: username }],
        });
      });

      it('answers 404 for a number that does not exist or is not a number', async () => {
        await get(`${repo}/issues/99999`).expect(404);
        await get(`${repo}/issues/abc`).expect(404);
      });

      it('answers an unknown assignee with 422 on the assignees field', async () => {
        const response = await send(
          'post',
          `${repo}/issues`,
          { title: 'Ghost assignee', assignees: ['nobody-at-all'] },
          owner.key,
        ).expect(422);
        expect(response.body.errors).toEqual([
          { resource: 'Issue', field: 'assignees', code: 'invalid' },
        ]);
      });
    });

    describe('assignees', () => {
      it('adds with 201 and removes with 200, answering the issue', async () => {
        const issue = await openIssue('Assign me');
        const added = await send(
          'post',
          `${repo}/issues/${issue.number}/assignees`,
          { assignees: [username] },
          owner.key,
        ).expect(201);
        expect(added.body.assignees).toEqual([
          expect.objectContaining({ login: username }),
        ]);
        const removed = await send(
          'delete',
          `${repo}/issues/${issue.number}/assignees`,
          { assignees: [username] },
          owner.key,
        ).expect(200);
        expect(removed.body.assignees).toEqual([]);
      });

      it('ignores additions from someone who cannot triage', async () => {
        const issue = await openIssue('Not yours to assign');
        const response = await send(
          'post',
          `${repo}/issues/${issue.number}/assignees`,
          { assignees: [username] },
          stranger.key,
        ).expect(201);
        expect(response.body.assignees).toEqual([]);
      });

      it('lists people with access and checks a login with 204 or 404', async () => {
        const { body } = await get(`${repo}/assignees`).expect(200);
        expect(body.map((user: { login: string }) => user.login)).toEqual([
          username,
        ]);
        await get(`${repo}/assignees/${username}`).expect(204);
        await get(`${repo}/assignees/nobody-at-all`).expect(404);
        const issue = await openIssue('Check assignee');
        await get(
          `${repo}/issues/${issue.number}/assignees/${username}`,
        ).expect(204);
      });
    });

    describe('labels', () => {
      it('creates, reads, renames and deletes a label by name', async () => {
        const created = await send(
          'post',
          `${repo}/labels`,
          { name: 'needs triage', color: '#D73A4A', description: 'Look at me' },
          owner.key,
        ).expect(201);
        expect(created.headers.location).toBe(created.body.url);
        expect(created.body).toMatchObject({
          id: expect.any(Number),
          name: 'needs triage',
          color: 'd73a4a',
          description: 'Look at me',
          default: false,
          archived_at: null,
          archived_by: null,
        });
        expect(created.body.url).toMatch(/\/labels\/needs%20triage$/);

        const duplicate = await send(
          'post',
          `${repo}/labels`,
          { name: 'needs triage' },
          owner.key,
        ).expect(422);
        expect(duplicate.body).toMatchObject({
          message: 'Validation Failed',
          errors: [
            { resource: 'Label', field: 'name', code: 'already_exists' },
          ],
          status: '422',
        });

        await get(`${repo}/labels/needs%20triage`).expect(200);
        const renamed = await send(
          'patch',
          `${repo}/labels/needs%20triage`,
          { new_name: 'triaged', color: '0e8a16' },
          owner.key,
        ).expect(200);
        expect(renamed.body).toMatchObject({
          name: 'triaged',
          color: '0e8a16',
        });
        await get(`${repo}/labels/needs%20triage`).expect(404);
        await send('delete', `${repo}/labels/triaged`, {}, owner.key).expect(
          204,
        );
        await get(`${repo}/labels/triaged`).expect(404);
      });

      it('defaults a new label to ededed and pages the list', async () => {
        const { body } = await send(
          'post',
          `${repo}/labels`,
          { name: 'plain' },
          owner.key,
        ).expect(201);
        expect(body.color).toBe('ededed');
        const page = await get(`${repo}/labels?per_page=1`).expect(200);
        expect(page.body).toHaveLength(1);
        expect(pagesIn(page.headers.link).next).toBe(2);
      });

      it('matches label names ignoring case and keeps the stored spelling', async () => {
        await send(
          'post',
          `${repo}/labels`,
          { name: 'Bug Report' },
          owner.key,
        ).expect(201);
        const duplicate = await send(
          'post',
          `${repo}/labels`,
          { name: 'bug report' },
          owner.key,
        ).expect(422);
        expect(duplicate.body.errors).toEqual([
          { resource: 'Label', field: 'name', code: 'already_exists' },
        ]);

        const read = await get(`${repo}/labels/BUG%20REPORT`).expect(200);
        expect(read.body.name).toBe('Bug Report');
        const recased = await send(
          'patch',
          `${repo}/labels/bug%20report`,
          { new_name: 'Bug report' },
          owner.key,
        ).expect(200);
        expect(recased.body.name).toBe('Bug report');

        const issue = await openIssue('Case-blind labels');
        const at = `${repo}/issues/${issue.number}/labels`;
        const added = await send('post', at, ['BUG REPORT'], owner.key).expect(
          200,
        );
        expect(added.body.map((label: { name: string }) => label.name)).toEqual(
          ['Bug report'],
        );
        const all = await get(`${repo}/labels?per_page=100`).expect(200);
        expect(
          all.body.filter(
            (label: { name: string }) =>
              label.name.toLowerCase() === 'bug report',
          ),
        ).toHaveLength(1);
        await send('delete', `${at}/bug%20REPORT`, {}, owner.key).expect(200);

        await send(
          'delete',
          `${repo}/labels/BUG%20report`,
          {},
          owner.key,
        ).expect(204);
        await get(`${repo}/labels/bug%20report`).expect(404);
      });

      it('refuses names with surrounding whitespace or made only of one or two dots', async () => {
        for (const name of [
          '  spaced  ',
          ' nbsp ',
          '　ideo　',
          '\u000bvt\u000b',
          '   ',
          '.',
          '..',
        ]) {
          const refused = await send(
            'post',
            `${repo}/labels`,
            { name },
            owner.key,
          ).expect(422);
          expect(refused.body.errors).toEqual([
            { resource: 'Label', field: 'name', code: 'invalid' },
          ]);
        }
        await send('post', `${repo}/labels`, { name: '...' }, owner.key).expect(
          201,
        );
        await send(
          'patch',
          `${repo}/labels/...`,
          { new_name: '.. ' },
          owner.key,
        ).expect(422);
      });

      it("adds, replaces and removes an issue's labels in every body shape GitHub takes", async () => {
        const issue = await openIssue('Label me');
        const at = `${repo}/issues/${issue.number}/labels`;
        const names = (body: { name: string }[]) =>
          body.map((label) => label.name).sort();

        const added = await send('post', at, ['alpha'], owner.key).expect(200);
        expect(names(added.body)).toEqual(['alpha']);
        const more = await send(
          'post',
          at,
          { labels: [{ name: 'beta' }] },
          owner.key,
        ).expect(200);
        expect(names(more.body)).toEqual(['alpha', 'beta']);
        const listed = await get(at).expect(200);
        expect(names(listed.body)).toEqual(['alpha', 'beta']);

        const replaced = await send(
          'put',
          at,
          { labels: ['gamma', 'alpha'] },
          owner.key,
        ).expect(200);
        expect(names(replaced.body)).toEqual(['alpha', 'gamma']);

        const left = await send('delete', `${at}/gamma`, {}, owner.key).expect(
          200,
        );
        expect(names(left.body)).toEqual(['alpha']);
        await send('delete', `${at}/gamma`, {}, owner.key).expect(404);

        await send('delete', at, {}, owner.key).expect(204);
        expect((await get(at).expect(200)).body).toEqual([]);

        const invalid = await send(
          'post',
          at,
          { labels: [7] },
          owner.key,
        ).expect(422);
        expect(invalid.body.errors).toEqual([
          { resource: 'Label', field: 'labels', code: 'invalid' },
        ]);
      });
    });

    describe('comments', () => {
      it('creates, reads, edits and deletes a comment by its integer id', async () => {
        const issue = await openIssue('Discuss');
        const created = await send(
          'post',
          `${repo}/issues/${issue.number}/comments`,
          { body: 'First!' },
          owner.key,
        ).expect(201);
        const comment = created.body;
        expect(created.headers.location).toBe(comment.url);
        expect(comment).toMatchObject({
          id: expect.any(Number),
          body: 'First!',
          user: { login: username },
          author_association: 'OWNER',
          issue_url: issue.url,
        });
        expect(comment.url).toMatch(
          new RegExp(`/issues/comments/${comment.id}$`),
        );
        expect(comment.html_url).toMatch(/#issuecomment-ic_/);

        await get(`${repo}/issues/comments/${comment.id}`).expect(200);
        await send(
          'patch',
          `${repo}/issues/comments/${comment.id}`,
          { body: 'Not yours' },
          stranger.key,
        ).expect(403);
        const edited = await send(
          'patch',
          `${repo}/issues/comments/${comment.id}`,
          { body: 'Edited' },
          owner.key,
        ).expect(200);
        expect(edited.body).toMatchObject({ id: comment.id, body: 'Edited' });

        const listed = await get(
          `${repo}/issues/${issue.number}/comments`,
        ).expect(200);
        expect(listed.body.map((c: { id: number }) => c.id)).toEqual([
          comment.id,
        ]);
        expect(
          (await get(`${repo}/issues/${issue.number}`).expect(200)).body
            .comments,
        ).toBe(1);

        await send(
          'delete',
          `${repo}/issues/comments/${comment.id}`,
          {},
          owner.key,
        ).expect(204);
        await get(`${repo}/issues/comments/${comment.id}`).expect(404);
      });

      it('answers 404 for a comment id from another repository', async () => {
        const secret = (
          await send(
            'post',
            `/repos/${username}/secret-repo/issues`,
            { title: 'Hidden' },
            owner.key,
          ).expect(201)
        ).body;
        const comment = (
          await send(
            'post',
            `/repos/${username}/secret-repo/issues/${secret.number}/comments`,
            { body: 'Hidden comment' },
            owner.key,
          ).expect(201)
        ).body;
        await get(`${repo}/issues/comments/${comment.id}`, owner.key).expect(
          404,
        );
      });

      it('lists every comment in the repository, oldest first unless sorted', async () => {
        const issue = await openIssue('Thread');
        for (const body of ['one', 'two'])
          await send(
            'post',
            `${repo}/issues/${issue.number}/comments`,
            { body },
            owner.key,
          ).expect(201);
        const all = await get(`${repo}/issues/comments?per_page=100`).expect(
          200,
        );
        const bodies = all.body.map((c: { body: string }) => c.body);
        expect(bodies.indexOf('one')).toBeLessThan(bodies.indexOf('two'));
        const newest = await get(
          `${repo}/issues/comments?sort=created&per_page=1`,
        ).expect(200);
        expect(newest.body[0].body).toBe('two');
        const none = await get(
          `${repo}/issues/${issue.number}/comments?since=2999-01-01T00:00:00Z`,
        ).expect(200);
        expect(none.body).toEqual([]);
      });
    });
  },
);
