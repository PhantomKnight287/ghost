import path from 'node:path';
import { createDatabase, type Database, type Pool, schema } from '@ghost/db';
import { and, eq, inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PullRequestReopenError } from '../../resources/issues/issues.errors.js';
import { IssuesService } from '../../resources/issues/issues.service.js';
import { RepositoryAccessService } from '../git/repository-access/repository-access.service.js';
import { UsersService } from '../users/users.service.js';
import { IssueReferencesService } from './issue-references.service.js';

const CONNECTION = process.env.TEST_DATABASE_URL;
const MIGRATIONS = path.resolve(
  import.meta.dirname,
  '../../../../../packages/db/drizzle',
);

const OWNER = 'user_refspec_owner';
const STRANGER = 'user_refspec_stranger';

// Needs a throwaway Postgres; the suite is skipped without one.
describe.skipIf(!CONNECTION)('issue references', () => {
  let db: Database;
  let pool: Pool;
  let references: IssueReferencesService;
  let issues: IssuesService;
  let repository: typeof schema.repository.$inferSelect;
  let secret: typeof schema.repository.$inferSelect;

  const open = (title: string, body: string | null, isPullRequest = false) =>
    issues.open(
      { repository, title, body, authorId: OWNER, isPullRequest },
      async () => {},
    );

  const referencesTo = (issueId: string) =>
    db
      .select()
      .from(schema.issueReference)
      .where(eq(schema.issueReference.targetIssueId, issueId));

  beforeAll(async () => {
    ({ db, pool } = createDatabase({ connectionString: CONNECTION }));
    await migrate(db, { migrationsFolder: MIGRATIONS });

    references = new IssueReferencesService(db);
    issues = new IssuesService(
      db,
      new UsersService(db),
      new RepositoryAccessService(db),
      references,
    );
  });

  beforeEach(async () => {
    await db
      .delete(schema.user)
      .where(inArray(schema.user.id, [OWNER, STRANGER]));
    await db.insert(schema.user).values([
      {
        id: OWNER,
        name: 'Owner',
        email: 'refspec-owner@example.com',
        username: 'refspec-owner',
      },
      {
        id: STRANGER,
        name: 'Stranger',
        email: 'refspec-stranger@example.com',
        username: 'refspec-stranger',
      },
    ]);
    [repository, secret] = await db
      .insert(schema.repository)
      .values([
        { name: 'app', slug: 'app', ownerId: OWNER, visibility: 'public' },
        { name: 'secret', slug: 'secret', ownerId: OWNER },
      ])
      .returning();
  });

  afterAll(async () => {
    await db
      .delete(schema.user)
      .where(inArray(schema.user.id, [OWNER, STRANGER]));
    await pool?.end();
  });

  it('numbers issues and pull requests from one sequence', async () => {
    const issue = await open('an issue', null);
    const pull = await open('a pull request', null, true);

    expect([issue.number, pull.number]).toEqual([1, 2]);
  });

  it('records same-repository and cross-repository references, skipping itself and unknown numbers', async () => {
    const target = await open('target', null);
    const elsewhere = await issues.open(
      {
        repository: secret,
        title: 'secret target',
        body: null,
        authorId: OWNER,
        isPullRequest: false,
      },
      async () => {},
    );
    const source = await open(
      'source',
      'fixes #1, see #2 and #99, and refspec-owner/secret#1',
    );

    const rows = await db
      .select()
      .from(schema.issueReference)
      .where(eq(schema.issueReference.sourceId, source.id));
    expect(rows.map((row) => [row.targetIssueId, row.closing]).sort()).toEqual(
      [
        [target.id, true],
        [elsewhere.id, false],
      ].sort(),
    );
  });

  it('resolves nothing in a repository the author cannot read', async () => {
    const hidden = await issues.open(
      {
        repository: secret,
        title: 'hidden',
        body: null,
        authorId: OWNER,
        isPullRequest: false,
      },
      async () => {},
    );
    await references.record(
      db,
      {
        type: 'comment',
        id: 'ic_stranger',
        repository,
        issueId: null,
        actorId: STRANGER,
      },
      'refspec-owner/secret#1',
    );

    expect(await referencesTo(hidden.id)).toEqual([]);
  });

  it('keeps a surviving reference on edit, updates its closing flag and drops removed ones', async () => {
    const first = await open('first', null);
    const second = await open('second', null);
    const source = await open('source', 'see #1 and #2');
    const [before] = await referencesTo(first.id);

    await issues.updateIssue({
      username: 'refspec-owner',
      repo: 'app',
      number: source.number,
      requesterId: OWNER,
      body: { body: 'closes #1' },
    });

    const [after] = await referencesTo(first.id);
    expect(after).toMatchObject({ id: before.id, closing: true });
    expect(await referencesTo(second.id)).toEqual([]);
  });

  it('forgets a deleted comment’s references', async () => {
    const target = await open('target', null);
    const source = await open('source', null);
    const ref = {
      username: 'refspec-owner',
      repo: 'app',
      number: source.number,
    };
    const comment = await issues.createComment({
      ...ref,
      requesterId: OWNER,
      body: 'relates to #1',
    });
    expect(await referencesTo(target.id)).toHaveLength(1);

    await issues.deleteComment({
      ...ref,
      requesterId: OWNER,
      commentId: comment.id,
    });
    expect(await referencesTo(target.id)).toEqual([]);
  });

  it('shows one mention per source issue, and hides private sources from other viewers', async () => {
    const target = await open('target', null);
    const source = await open('source', 'see #1');
    await issues.createComment({
      username: 'refspec-owner',
      repo: 'app',
      number: source.number,
      requesterId: OWNER,
      body: 'again #1',
    });
    await references.record(
      db,
      {
        type: 'issue',
        id: 'issue_private_source',
        repository: secret,
        issueId: null,
        actorId: OWNER,
      },
      'refspec-owner/app#1',
    );

    const owner = await references.mentionsOf(target.id, { userId: OWNER });
    const stranger = await references.mentionsOf(target.id, {
      userId: STRANGER,
    });

    expect(owner).toHaveLength(2);
    expect(stranger).toEqual([
      expect.objectContaining({
        sourceType: 'issue',
        repository: { username: 'refspec-owner', slug: 'app' },
        source: {
          number: source.number,
          title: 'source',
          state: 'open',
          isPullRequest: false,
        },
      }),
    ]);
  });

  it('closes issues a commit promises to, but never a pull request or a repository the pusher cannot write to', async () => {
    const issue = await open('bug', null);
    const pull = await open('pr', null, true);

    await references.closeFromCommits({
      repository,
      actorId: STRANGER,
      commits: [commit('aaaa', 'fixes #1')],
    });
    expect(await stateOf(issue.id)).toBe('open');

    await references.closeFromCommits({
      repository,
      actorId: OWNER,
      commits: [commit('bbbb', 'fixes #1 and closes #2')],
    });
    expect(await stateOf(issue.id)).toBe('closed');
    expect(await stateOf(pull.id)).toBe('open');

    const [event] = await db
      .select()
      .from(schema.issueEvent)
      .where(
        and(
          eq(schema.issueEvent.issueId, issue.id),
          eq(schema.issueEvent.type, 'closed'),
        ),
      );
    expect(event).toMatchObject({ actorId: OWNER, commitSha: 'bbbb' });

    expect(await references.mentionsOf(issue.id, null)).toEqual([
      expect.objectContaining({
        sourceType: 'commit',
        commitSha: 'aaaa',
        source: null,
      }),
      expect.objectContaining({
        sourceType: 'commit',
        commitSha: 'bbbb',
        source: null,
      }),
    ]);
  });

  it('keeps a pull request in step when it is closed as an issue, and refuses to reopen it', async () => {
    const pull = await open('pr', null, true);
    await db.insert(schema.pullRequest).values({
      issueId: pull.id,
      baseRepositoryId: repository.id,
      baseRef: 'main',
      headRepositoryId: repository.id,
      headRef: 'feature',
      headSha: 'cccc',
    });
    const ref = {
      username: 'refspec-owner',
      repo: 'app',
      number: pull.number,
      requesterId: OWNER,
    };

    await issues.closeIssue(ref);
    const [row] = await db
      .select({ state: schema.pullRequest.state })
      .from(schema.pullRequest)
      .where(eq(schema.pullRequest.issueId, pull.id));
    expect(row.state).toBe('closed');

    await expect(issues.reopenIssue(ref)).rejects.toThrow(
      PullRequestReopenError,
    );
  });

  it('lists issues without pull requests', async () => {
    await open('issue', null);
    await open('pr', null, true);

    const { issues: listed } = await issues.getIssues({
      username: 'refspec-owner',
      repo: 'app',
      requesterId: OWNER,
      query: {},
    });
    expect(listed.map((issue) => issue.title)).toEqual(['issue']);
  });

  it('puts mentions into the timeline', async () => {
    await open('target', null);
    await open('source', 'see #1');

    const { timeline } = await issues.getTimeline({
      username: 'refspec-owner',
      repo: 'app',
      number: 1,
      requesterId: OWNER,
    });
    expect(timeline.map((item) => item.kind)).toEqual(['event', 'reference']);
  });

  function stateOf(issueId: string) {
    return db
      .select({ state: schema.issue.state })
      .from(schema.issue)
      .where(eq(schema.issue.id, issueId))
      .then(([row]) => row.state);
  }
});

function commit(sha: string, subject: string) {
  return {
    sha,
    subject,
    body: '',
    authorName: 'a',
    authorEmail: 'a@example.com',
    committedAt: new Date().toISOString(),
  };
}
