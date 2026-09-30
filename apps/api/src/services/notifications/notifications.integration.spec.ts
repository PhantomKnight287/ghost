import path from 'node:path';
import { createDatabase, type Database, type Pool, schema } from '@ghost/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { publishEvent } from '../../lib/events/events.js';
import { closeIssue } from '../../lib/issues/close-issue.js';
import type { MailService } from '../../mail/mail.service.js';
import { IssuesService } from '../../resources/issues/issues.service.js';
import { NotificationsService } from '../../resources/notifications/notifications.service.js';
import { OutboxService } from '../events/outbox.service.js';
import { RepositoryAccessService } from '../git/repository-access/repository-access.service.js';
import { IssueReferencesService } from '../issues/issue-references.service.js';
import { UsersService } from '../users/users.service.js';
import { NotifierService } from './notifier.service.js';
import type { WebhookFanoutService } from '../webhooks/webhook-fanout.service.js';

const CONNECTION = process.env.TEST_DATABASE_URL;
const noWebhooks = {
  handle: async () => {},
} as unknown as WebhookFanoutService;
const MIGRATIONS = path.resolve(
  import.meta.dirname,
  '../../../../../packages/db/drizzle',
);

const OWNER = 'user_ntf_owner';
const ALICE = 'user_ntf_alice';
const BOB = 'user_ntf_bob';
const CAROL = 'user_ntf_carol';
const USERS = [OWNER, ALICE, BOB, CAROL];
const ORGANIZATION = 'org_ntf';

// Needs a throwaway Postgres; the suite is skipped without one.
describe.skipIf(!CONNECTION)('notifications', () => {
  let db: Database;
  let pool: Pool;
  let issues: IssuesService;
  let notifier: NotifierService;
  let outbox: OutboxService;
  let inbox: NotificationsService;
  let sendThreadEmail: ReturnType<typeof vi.fn>;
  let repository: typeof schema.repository.$inferSelect;
  let secret: typeof schema.repository.$inferSelect;

  const ref = (requesterId: string, number: number) => ({
    username: 'ntf-owner',
    repo: 'app',
    number,
    requesterId,
  });

  const open = (
    body: string | null,
    authorId = OWNER,
    assignees: string[] = [],
  ) =>
    issues.createIssue({
      username: 'ntf-owner',
      repo: 'app',
      requesterId: authorId,
      body: { title: 'Bell', body: body ?? undefined, assignees },
    });

  /** Notifications as each user's inbox holds them, keyed by user id. */
  async function notified(issueId: string) {
    const rows = await db
      .select({
        userId: schema.notification.userId,
        reason: schema.notification.reason,
        eventType: schema.notification.eventType,
        unread: schema.notification.unread,
      })
      .from(schema.notification)
      .where(eq(schema.notification.issueId, issueId));
    return Object.fromEntries(rows.map(({ userId, ...row }) => [userId, row]));
  }

  const emailsTo = () =>
    sendThreadEmail.mock.calls.map(([to, email]) => [to, email.template]);

  beforeAll(async () => {
    ({ db, pool } = createDatabase({ connectionString: CONNECTION }));
    await migrate(db, { migrationsFolder: MIGRATIONS });
  });

  beforeEach(async () => {
    const access = new RepositoryAccessService(db);
    issues = new IssuesService(
      db,
      new UsersService(db),
      access,
      new IssueReferencesService(db),
    );
    sendThreadEmail = vi.fn();
    notifier = new NotifierService(db, access, {
      sendThreadEmail,
    } as unknown as MailService);
    outbox = new OutboxService(db, notifier, noWebhooks, { pool });
    inbox = new NotificationsService(db, access, issues);

    await db.delete(schema.user).where(inArray(schema.user.id, USERS));
    await db
      .delete(schema.organization)
      .where(eq(schema.organization.id, ORGANIZATION));
    await db.insert(schema.user).values(
      USERS.map((id) => {
        const name = id.replace('user_ntf_', '');
        return {
          id,
          name,
          email: `ntf-${name}@example.com`,
          username: `ntf-${name}`,
          emailVerified: true,
        };
      }),
    );
    [repository, secret] = await db
      .insert(schema.repository)
      .values([
        { name: 'app', slug: 'app', ownerId: OWNER, visibility: 'public' },
        { name: 'secret', slug: 'secret', ownerId: OWNER },
      ])
      .returning();
  });

  afterAll(async () => {
    await db.delete(schema.user).where(inArray(schema.user.id, USERS));
    await db
      .delete(schema.organization)
      .where(eq(schema.organization.id, ORGANIZATION));
    await pool?.end();
  });

  it('notifies mentioned and assigned people when an issue opens, and subscribes them', async () => {
    const issue = await open('@ntf-alice can you look? cc @ntf-nobody', OWNER, [
      'ntf-bob',
    ]);
    await outbox.drain();

    expect(await notified(issue.id)).toEqual({
      [ALICE]: { reason: 'mentioned', eventType: 'issue.opened', unread: true },
      [BOB]: { reason: 'assigned', eventType: 'issue.opened', unread: true },
    });
    expect(emailsTo().sort()).toEqual([
      ['ntf-alice@example.com', 'thread-opened'],
      ['ntf-bob@example.com', 'thread-opened'],
    ]);
    expect(sendThreadEmail.mock.calls[0][1]).toMatchObject({
      threadId: issue.id,
      subject: '[ntf-owner/app] Bell (#1)',
      context: {
        actor: 'ntf-owner',
        path: '/ntf-owner/app/issues/1',
        number: 1,
      },
    });

    const subscribers = await db
      .select({ userId: schema.issueSubscription.userId })
      .from(schema.issueSubscription)
      .where(eq(schema.issueSubscription.issueId, issue.id));
    expect(subscribers.map((row) => row.userId).sort()).toEqual(
      [ALICE, BOB, OWNER].sort(),
    );
  });

  it('notifies the author and earlier commenters about a comment, never the commenter', async () => {
    const issue = await open(null);
    await issues.createComment({
      ...ref(CAROL, issue.number),
      body: 'Same here.',
    });
    await outbox.drain();
    expect(await notified(issue.id)).toEqual({
      [OWNER]: { reason: 'author', eventType: 'issue.commented', unread: true },
    });

    await issues.createComment({ ...ref(OWNER, issue.number), body: 'Fixed.' });
    await outbox.drain();
    expect(await notified(issue.id)).toEqual({
      [OWNER]: { reason: 'author', eventType: 'issue.commented', unread: true },
      [CAROL]: {
        reason: 'subscribed',
        eventType: 'issue.commented',
        unread: true,
      },
    });
    expect(sendThreadEmail.mock.calls.at(-1)?.[1]).toMatchObject({
      template: 'thread-comment',
      context: { body: 'Fixed.', file: null, reason: 'subscribed' },
    });
  });

  it('follows watching and ignoring, and an unsubscribe outlasts commenting but not a mention', async () => {
    await inbox.setWatch({
      username: 'ntf-owner',
      repo: 'app',
      requesterId: ALICE,
      level: 'all',
    });
    await inbox.setWatch({
      username: 'ntf-owner',
      repo: 'app',
      requesterId: BOB,
      level: 'ignore',
    });
    const issue = await open('@ntf-bob');
    await outbox.drain();
    expect(await notified(issue.id)).toEqual({
      [ALICE]: { reason: 'watching', eventType: 'issue.opened', unread: true },
    });

    await inbox.setSubscription({
      ...ref(ALICE, issue.number),
      subscribed: false,
    });
    await issues.createComment({ ...ref(ALICE, issue.number), body: 'hm' });
    await issues.createComment({
      ...ref(OWNER, issue.number),
      body: 'hm indeed',
    });
    await outbox.drain();
    expect((await notified(issue.id))[ALICE]?.eventType).toBe('issue.opened');

    await issues.createComment({
      ...ref(OWNER, issue.number),
      body: '@ntf-alice ping',
    });
    await outbox.drain();
    expect((await notified(issue.id))[ALICE]).toMatchObject({
      reason: 'mentioned',
    });
    await expect(
      inbox.getSubscription(ref(ALICE, issue.number)),
    ).resolves.toEqual({ subscribed: false });

    await inbox.setWatch({
      username: 'ntf-owner',
      repo: 'app',
      requesterId: ALICE,
      level: 'participating',
    });
    await expect(
      inbox.getWatch({
        username: 'ntf-owner',
        repo: 'app',
        requesterId: ALICE,
      }),
    ).resolves.toEqual({ level: 'participating' });
  });

  it('never notifies or subscribes someone mentioned in a repository they cannot read', async () => {
    const hidden = await issues.createIssue({
      username: 'ntf-owner',
      repo: 'secret',
      requesterId: OWNER,
      body: { title: 'Hidden', body: '@ntf-alice' },
    });
    await outbox.drain();

    expect(await notified(hidden.id)).toEqual({});
    const subscribed = await db
      .select()
      .from(schema.issueSubscription)
      .where(
        and(
          eq(schema.issueSubscription.issueId, hidden.id),
          eq(schema.issueSubscription.userId, ALICE),
        ),
      );
    expect(subscribed).toEqual([]);
    expect(secret.visibility).toBe('private');
  });

  it('notifies about assigning, closing, reopening and merging', async () => {
    const issue = await open(null, CAROL);
    await issues.setIssueAssignees({
      ...ref(OWNER, issue.number),
      usernames: ['ntf-alice'],
    });
    await outbox.drain();
    expect(await notified(issue.id)).toEqual({
      [ALICE]: {
        reason: 'assigned',
        eventType: 'issue.assigned',
        unread: true,
      },
      [CAROL]: { reason: 'author', eventType: 'issue.assigned', unread: true },
    });

    await issues.closeIssue(ref(OWNER, issue.number));
    await issues.reopenIssue(ref(OWNER, issue.number));
    await outbox.drain();
    expect(
      sendThreadEmail.mock.calls
        .map(([, email]) => email.context.state ?? email.template)
        .slice(-4),
    ).toEqual(['closed', 'closed', 'reopened', 'reopened']);

    await closeIssue(db, { issueId: issue.id, actorId: OWNER, type: 'merged' });
    await outbox.drain();
    expect((await notified(issue.id))[CAROL]).toMatchObject({
      eventType: 'pull_request.merged',
    });
  });

  it('leaves webhook-only events out of the inbox', async () => {
    const issue = await open(null, CAROL);
    await outbox.drain();
    const before = await notified(issue.id);
    sendThreadEmail.mockClear();

    await issues.updateIssue({
      ...ref(CAROL, issue.number),
      body: { title: 'Bell count', body: '@ntf-alice see this' },
    });
    await outbox.drain();

    expect(await notified(issue.id)).toEqual(before);
    expect(sendThreadEmail).not.toHaveBeenCalled();
  });

  it('notifies about a review and a reply to one of its comments', async () => {
    const pull = await issues.open(
      {
        repository,
        title: 'Bell',
        body: null,
        authorId: OWNER,
        isPullRequest: true,
      },
      async (tx, row) => {
        await tx.insert(schema.pullRequest).values({
          issueId: row.id,
          baseRepositoryId: repository.id,
          baseRef: 'main',
          headRepositoryId: repository.id,
          headRef: 'bell',
          headSha: 'aaaa',
        });
      },
    );
    const [{ id: pullRequestId }] = await db
      .select({ id: schema.pullRequest.id })
      .from(schema.pullRequest)
      .where(eq(schema.pullRequest.issueId, pull.id));
    const [review] = await db
      .insert(schema.pullRequestReview)
      .values({
        pullRequestId,
        authorId: ALICE,
        state: 'changes_requested',
        body: 'Nearly.',
        commitSha: 'aaaa',
        submittedAt: new Date(),
      })
      .returning();
    const line = {
      pullRequestId,
      path: 'src/bell.tsx',
      side: 'additions' as const,
      line: 3,
      commitSha: 'aaaa',
    };
    const [comment] = await db
      .insert(schema.pullRequestReviewComment)
      .values({
        ...line,
        reviewId: review.id,
        authorId: ALICE,
        body: 'ask @ntf-carol',
      })
      .returning();
    const [reply] = await db
      .insert(schema.pullRequestReviewComment)
      .values({
        ...line,
        inReplyToId: comment.id,
        authorId: OWNER,
        body: 'Done.',
      })
      .returning();
    await publishEvent(db, {
      type: 'pull_request.reviewed',
      repositoryId: repository.id,
      actorId: ALICE,
      payload: { issueId: pull.id, reviewId: review.id },
    });
    await outbox.drain();

    expect(await notified(pull.id)).toEqual({
      [OWNER]: {
        reason: 'author',
        eventType: 'pull_request.reviewed',
        unread: true,
      },
      [CAROL]: {
        reason: 'mentioned',
        eventType: 'pull_request.reviewed',
        unread: true,
      },
    });
    expect(sendThreadEmail.mock.calls.at(-1)?.[1]).toMatchObject({
      template: 'thread-review',
      context: {
        state: 'changes_requested',
        body: 'Nearly.',
        commentCount: 1,
        path: '/ntf-owner/app/pulls/1',
      },
    });

    sendThreadEmail.mockClear();
    await publishEvent(db, {
      type: 'pull_request.review_commented',
      repositoryId: repository.id,
      actorId: OWNER,
      payload: { issueId: pull.id, commentId: reply.id },
    });
    await outbox.drain();
    expect(emailsTo().sort()).toEqual([
      ['ntf-alice@example.com', 'thread-comment'],
      ['ntf-carol@example.com', 'thread-comment'],
    ]);
    expect(sendThreadEmail.mock.calls[0][1].context).toMatchObject({
      body: 'Done.',
      file: 'src/bell.tsx',
    });
  });

  it('emails only verified addresses, keeps line breaks out of the subject, and stops reading mentions after fifty', async () => {
    await db
      .update(schema.user)
      .set({ emailVerified: false })
      .where(eq(schema.user.id, BOB));
    const issue = await issues.createIssue({
      username: 'ntf-owner',
      repo: 'app',
      requesterId: OWNER,
      body: {
        title: 'Line\r\nBcc: everyone@example.com',
        body: '@ntf-alice @ntf-bob',
      },
    });
    await outbox.drain();

    expect(Object.keys(await notified(issue.id)).sort()).toEqual(
      [ALICE, BOB].sort(),
    );
    expect(emailsTo()).toEqual([['ntf-alice@example.com', 'thread-opened']]);
    expect(sendThreadEmail.mock.calls[0][1].subject).toBe(
      '[ntf-owner/app] Line Bcc: everyone@example.com (#1)',
    );

    const crowd = Array.from(
      { length: 50 },
      (_, index) => `@ntf-ghost${index}`,
    ).join(' ');
    await issues.createComment({
      ...ref(OWNER, issue.number),
      body: `${crowd} @ntf-carol`,
    });
    await outbox.drain();
    expect((await notified(issue.id))[CAROL]).toBeUndefined();
  });

  it('pages a team only for its own organization, and only from a member', async () => {
    await db.insert(schema.organization).values({
      id: ORGANIZATION,
      name: 'Acme',
      slug: 'ntf-acme',
      createdAt: new Date(),
    });
    await db.insert(schema.member).values({
      id: 'member_ntf_owner',
      organizationId: ORGANIZATION,
      userId: OWNER,
      role: 'owner',
      createdAt: new Date(),
    });
    await db.insert(schema.team).values({
      id: 'team_ntf',
      name: 'Core Team',
      organizationId: ORGANIZATION,
      createdAt: new Date(),
    });
    await db.insert(schema.teamMember).values([
      { id: 'tm_ntf_alice', teamId: 'team_ntf', userId: ALICE },
      { id: 'tm_ntf_bob', teamId: 'team_ntf', userId: BOB },
    ]);
    await db
      .update(schema.repository)
      .set({ organizationId: ORGANIZATION })
      .where(eq(schema.repository.id, repository.id));
    const org = { username: 'ntf-acme', repo: 'app' };

    const fromMember = await issues.createIssue({
      ...org,
      requesterId: OWNER,
      body: { title: 'Team', body: '@ntf-acme/core-team and @other/core-team' },
    });
    const fromOutsider = await issues.createIssue({
      ...org,
      requesterId: CAROL,
      body: { title: 'Team', body: '@ntf-acme/core-team' },
    });
    await outbox.drain();

    expect(
      Object.values(await notified(fromMember.id)).map((row) => row.reason),
    ).toEqual(['team_mentioned', 'team_mentioned']);
    expect(await notified(fromOutsider.id)).toEqual({});
  });

  it('skips an event whose comment was deleted before it was handled', async () => {
    const issue = await open(null);
    const comment = await issues.createComment({
      ...ref(CAROL, issue.number),
      body: 'oops',
    });
    await issues.deleteComment({
      ...ref(CAROL, issue.number),
      commentId: comment.id,
    });
    await outbox.drain();

    expect(await notified(issue.id)).toEqual({});
  });

  it('lists, counts and marks the inbox, hiding threads the user can no longer read', async () => {
    const first = await open('@ntf-alice');
    const hidden = await issues.createIssue({
      username: 'ntf-owner',
      repo: 'secret',
      requesterId: OWNER,
      body: { title: 'Hidden', body: '@ntf-alice' },
    });
    await db.insert(schema.repositoryCollaborator).values({
      repositoryId: secret.id,
      userId: ALICE,
      role: 'read',
      acceptedAt: new Date(),
    });
    await issues.createComment({
      username: 'ntf-owner',
      repo: 'secret',
      number: hidden.number,
      requesterId: OWNER,
      body: '@ntf-alice now you can see this',
    });
    const second = await open('@ntf-alice again');
    await outbox.drain();

    const page = await inbox.list(ALICE, { limit: 2 });
    expect(page.notifications.map((row) => row.thread.number)).toEqual([
      second.number,
      hidden.number,
    ]);
    expect(page.notifications[0]).toMatchObject({
      reason: 'mentioned',
      actorUsername: 'ntf-owner',
      unread: true,
      repository: { owner: 'ntf-owner', slug: 'app' },
      thread: { title: 'Bell', isPullRequest: false, state: 'open' },
    });
    const rest = await inbox.list(ALICE, {
      limit: 2,
      cursor: page.nextCursor ?? undefined,
    });
    expect(rest.notifications.map((row) => row.thread.number)).toEqual([
      first.number,
    ]);
    expect(rest.nextCursor).toBeNull();
    await expect(inbox.unreadCount(ALICE)).resolves.toEqual({ count: 3 });

    await db
      .delete(schema.repositoryCollaborator)
      .where(eq(schema.repositoryCollaborator.userId, ALICE));
    await expect(inbox.unreadCount(ALICE)).resolves.toEqual({ count: 2 });

    await inbox.setUnread(ALICE, page.notifications[0].id, false);
    await expect(inbox.list(ALICE, { unread: true })).resolves.toMatchObject({
      notifications: [{ thread: { number: first.number } }],
    });
    await inbox.markAllRead(ALICE);
    await expect(inbox.unreadCount(ALICE)).resolves.toEqual({ count: 0 });
    await expect(
      inbox.setUnread(BOB, page.notifications[0].id, true),
    ).rejects.toThrow('Notification not found');
  });

  it('retries a failing event and sets it aside after five attempts', async () => {
    const failing = new OutboxService(
      db,
      {
        handle: () => Promise.reject(new Error('mail server on fire')),
      } as unknown as NotifierService,
      noWebhooks,
      { pool },
    );
    const issue = await open(null);
    const pending = () =>
      db
        .select()
        .from(schema.outboxEvent)
        .where(eq(schema.outboxEvent.repositoryId, repository.id));

    await failing.drain();
    expect(
      (await pending()).find((event) => event.payload.issueId === issue.id),
    ).toMatchObject({
      attempts: 1,
      lastError: 'mail server on fire',
      processedAt: null,
    });

    for (let attempt = 2; attempt <= 5; attempt++) await failing.drain();
    const [event] = await pending();
    expect(event.attempts).toBe(5);
    expect(event.processedAt).not.toBeNull();
  });

  it('drains past a failing event in one run', async () => {
    const first = await open(null);
    for (let i = 0; i < 20; i++) await open(null);
    const flaky = new OutboxService(
      db,
      {
        handle: (event: { payload: { issueId?: string } }) =>
          event.payload.issueId === first.id
            ? Promise.reject(new Error('mail server on fire'))
            : Promise.resolve(),
      } as unknown as NotifierService,
      noWebhooks,
      { pool },
    );

    await flaky.drain();
    const pending = await db
      .select()
      .from(schema.outboxEvent)
      .where(
        and(
          eq(schema.outboxEvent.repositoryId, repository.id),
          isNull(schema.outboxEvent.processedAt),
        ),
      );
    expect(pending).toMatchObject([{ attempts: 1 }]);
    expect(pending[0].payload.issueId).toBe(first.id);
  });

  it('drains on NOTIFY without polling', async () => {
    await outbox.onApplicationBootstrap();
    await outbox.drain(); // empty now, so only a NOTIFY can deliver the next event
    try {
      const issue = await open('@ntf-alice ping');
      await vi.waitFor(async () => {
        expect(await notified(issue.id)).toHaveProperty(ALICE);
      });
    } finally {
      await outbox.onApplicationShutdown();
    }
    // a listener handed back to the pool would still hear this and drain
    const drain = vi.spyOn(outbox, 'drain');
    for (let i = 0; i < 5; i++)
      await pool.query("select pg_notify('outbox', '')");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(drain).not.toHaveBeenCalled();
  });
});
