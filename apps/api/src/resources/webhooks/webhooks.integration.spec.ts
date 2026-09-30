import { randomBytes } from 'node:crypto';
import { createDatabase, type Database, type Pool, schema } from '@ghost/db';
import type { ConfigService } from '@nestjs/config';
import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { OrganizationForbiddenError } from '../../lib/organizations/organization.errors.js';
import type { WebhookOwner } from '../../lib/webhooks/webhooks.js';
import type { MailService } from '../../mail/mail.service.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { WebhookBreakerService } from '../../services/webhooks/webhook-breaker.service.js';
import { WebhookFanoutService } from '../../services/webhooks/webhook-fanout.service.js';
import { InvalidWebhookUrlError } from './webhooks.errors.js';
import { WebhooksService } from './webhooks.service.js';

const CONNECTION = process.env.TEST_DATABASE_URL;
const RUN = Date.now().toString(36);
const OWNER = `user_whk_${RUN}`;
const MEMBER = `user_whk_member_${RUN}`;
const USERNAME = `whk-${RUN}`;
const ORGANIZATION = `org_whk_${RUN}`;
const ORGANIZATION_SLUG = `whk-org-${RUN}`;
const MISSING_DELIVERY = '00000000-0000-4000-8000-000000000000';

// Touches only the users and organization it creates; deleting them cascades to their repositories, endpoints and jobs.
describe.skipIf(!CONNECTION)('webhooks', () => {
  let db: Database;
  let pool: Pool;
  let fanout: WebhookFanoutService;
  let webhooks: WebhooksService;
  let repository: typeof schema.repository.$inferSelect;
  let organizationRepository: typeof schema.repository.$inferSelect;
  let issue: typeof schema.issue.$inferSelect;
  let repositoryOwner: WebhookOwner;
  let organizationOwner: WebhookOwner;

  const jobsFor = (endpointId: string) =>
    db
      .select()
      .from(schema.deliveryJob)
      .where(eq(schema.deliveryJob.endpointId, endpointId))
      .orderBy(desc(schema.deliveryJob.createdAt));
  const eventsFor = async (endpointId: string) =>
    (await jobsFor(endpointId)).map(
      (job) => (job.payload as { event: string }).event,
    );
  const bodyOf = (job: typeof schema.deliveryJob.$inferSelect) =>
    JSON.parse((job.payload as { body: string }).body);
  const issueOpened = (repositoryId: string, issueId: string) => ({
    id: `evt_whk_${repositoryId}_${RUN}`,
    type: 'issue.opened' as const,
    repositoryId,
    actorId: OWNER,
    payload: { issueId },
    createdAt: new Date(),
  });

  beforeAll(async () => {
    ({ db, pool } = createDatabase({ connectionString: CONNECTION }));
    const config = {
      get: (name: string) =>
        ({
          WEBHOOK_SECRET_KEY: randomBytes(32).toString('base64'),
          WEB_APP_URL: 'https://ghost.test',
        })[name],
    } as unknown as ConfigService;
    fanout = new WebhookFanoutService(db, config);
    webhooks = new WebhooksService(
      db,
      new RepositoryAccessService(db),
      fanout,
      config,
    );

    await db.insert(schema.user).values([
      {
        id: OWNER,
        name: 'Webhook owner',
        email: `${USERNAME}@example.com`,
        username: USERNAME,
        emailVerified: true,
      },
      {
        id: MEMBER,
        name: 'Webhook member',
        email: `${USERNAME}-member@example.com`,
        username: `${USERNAME}-member`,
        emailVerified: true,
      },
    ]);
    await db.insert(schema.organization).values({
      id: ORGANIZATION,
      name: 'Webhook org',
      slug: ORGANIZATION_SLUG,
      createdAt: new Date(),
    });
    await db.insert(schema.member).values([
      {
        id: `mem_whk_owner_${RUN}`,
        organizationId: ORGANIZATION,
        userId: OWNER,
        role: 'owner',
        createdAt: new Date(),
      },
      {
        id: `mem_whk_member_${RUN}`,
        organizationId: ORGANIZATION,
        userId: MEMBER,
        role: 'member',
        createdAt: new Date(),
      },
    ]);
    [repository, organizationRepository] = await db
      .insert(schema.repository)
      .values([
        { name: 'app', slug: 'app', ownerId: OWNER, visibility: 'public' },
        {
          name: 'site',
          slug: 'site',
          ownerId: OWNER,
          organizationId: ORGANIZATION,
          visibility: 'public',
        },
      ])
      .returning();
    [issue] = await db
      .insert(schema.issue)
      .values({
        repositoryId: repository.id,
        number: 1,
        title: 'Bell count',
        body: 'The bell should show a count',
        authorId: OWNER,
      })
      .returning();

    repositoryOwner = await webhooks.ofRepository({
      username: USERNAME,
      repo: 'app',
      requesterId: OWNER,
    });
    organizationOwner = await webhooks.ofOrganization({
      slug: ORGANIZATION_SLUG,
      requesterId: OWNER,
    });
  });

  afterAll(async () => {
    await db
      .delete(schema.organization)
      .where(eq(schema.organization.id, ORGANIZATION));
    await db
      .delete(schema.user)
      .where(inArray(schema.user.id, [OWNER, MEMBER]));
    await pool?.end();
  });

  it('creates an endpoint, returns its secret once, and pings it', async () => {
    const created = await webhooks.create(repositoryOwner, {
      url: 'https://93.184.216.34/hook',
      events: ['issue.opened', 'issue.opened'],
    });
    expect(created.secret).toMatch(/^whsec_/);
    expect(created.events).toEqual(['issue.opened']);

    const [stored] = await db
      .select({ secret: schema.webhookEndpoint.secret })
      .from(schema.webhookEndpoint)
      .where(eq(schema.webhookEndpoint.id, created.id));
    expect(stored.secret).toMatch(/^v1:/);
    expect(stored.secret).not.toContain(created.secret);

    const [ping] = await jobsFor(created.id);
    expect(bodyOf(ping)).toMatchObject({
      event: 'ping',
      webhook: { id: created.id, events: ['issue.opened'] },
      repository: { fullName: `${USERNAME}/app` },
    });

    const listed = await webhooks.list(repositoryOwner);
    expect(listed.webhooks.map((webhook) => webhook.id)).toContain(created.id);
    expect(listed.webhooks[0]).not.toHaveProperty('secret');
  });

  it('refuses a URL that points inside the network', async () => {
    await expect(
      webhooks.create(repositoryOwner, {
        url: 'http://127.0.0.1:9000',
        events: ['issue.opened'],
      }),
    ).rejects.toBeInstanceOf(InvalidWebhookUrlError);
  });

  it('keeps one owner out of another owner’s webhooks, and members out of an organization’s', async () => {
    const created = await webhooks.create(repositoryOwner, {
      url: 'https://93.184.216.34/private',
      events: ['issue.opened'],
    });
    await expect(
      webhooks.deliveries(organizationOwner, created.id),
    ).rejects.toThrow('Webhook not found');
    await expect(
      webhooks.update(repositoryOwner, created.id, { url: 'http://10.0.0.1' }),
    ).rejects.toBeInstanceOf(InvalidWebhookUrlError);
    expect(
      await webhooks.update(repositoryOwner, created.id, {
        url: 'https://93.184.216.34/moved',
        events: ['push', 'push'],
      }),
    ).toMatchObject({ url: 'https://93.184.216.34/moved', events: ['push'] });
    await expect(
      webhooks.ofOrganization({ slug: ORGANIZATION_SLUG, requesterId: MEMBER }),
    ).rejects.toBeInstanceOf(OrganizationForbiddenError);
  });

  it('fans an event out once to the endpoints that chose it', async () => {
    const wanted = await webhooks.create(repositoryOwner, {
      url: 'https://93.184.216.34/wanted',
      events: ['issue.opened'],
    });
    const other = await webhooks.create(repositoryOwner, {
      url: 'https://93.184.216.34/other',
      events: ['issue.closed'],
    });
    const event = issueOpened(repository.id, issue.id);

    await fanout.handle(event);
    await fanout.handle(event); // a retried outbox event

    expect(await eventsFor(wanted.id)).toEqual(['issue.opened', 'ping']);
    const [delivery] = await jobsFor(wanted.id);
    expect(bodyOf(delivery)).toMatchObject({
      event: 'issue.opened',
      repository: { fullName: `${USERNAME}/app` },
      sender: { username: USERNAME },
      issue: {
        number: 1,
        title: 'Bell count',
        htmlUrl: `https://ghost.test/${USERNAME}/app/issues/1`,
      },
    });
    expect(await eventsFor(other.id)).toEqual(['ping']);
  });

  it('sends an organization webhook the events of every repository the organization owns', async () => {
    const created = await webhooks.create(organizationOwner, {
      url: 'https://93.184.216.34/org',
      events: ['issue.opened'],
    });
    expect(bodyOf((await jobsFor(created.id))[0])).toMatchObject({
      event: 'ping',
      organization: { slug: ORGANIZATION_SLUG },
    });
    const [orgIssue] = await db
      .insert(schema.issue)
      .values({
        repositoryId: organizationRepository.id,
        number: 1,
        title: 'Site is down',
        authorId: OWNER,
      })
      .returning();

    await fanout.handle(issueOpened(organizationRepository.id, orgIssue.id));
    await fanout.handle(issueOpened(repository.id, issue.id));

    expect(await eventsFor(created.id)).toEqual(['issue.opened', 'ping']);
    const [delivery] = await jobsFor(created.id);
    expect(bodyOf(delivery)).toMatchObject({
      repository: { fullName: `${ORGANIZATION_SLUG}/site` },
    });
    expect(
      (await webhooks.list(organizationOwner)).webhooks.map(({ id }) => id),
    ).toEqual([created.id]);
  });

  it('describes what each kind of event points at, and skips an event whose rows are gone', async () => {
    const webhook = await webhooks.create(repositoryOwner, {
      url: 'https://93.184.216.34/kinds',
      events: [
        'issue.commented',
        'issue.assigned',
        'pull_request.reviewed',
        'pull_request.review_commented',
      ],
    });
    const [pullIssue] = await db
      .insert(schema.issue)
      .values({
        repositoryId: repository.id,
        number: 2,
        title: 'Count the bell',
        authorId: OWNER,
        isPullRequest: true,
      })
      .returning();
    const [pull] = await db
      .insert(schema.pullRequest)
      .values({
        issueId: pullIssue.id,
        baseRepositoryId: repository.id,
        baseRef: 'main',
        headRepositoryId: repository.id,
        headRef: 'bell',
        headSha: 'b'.repeat(40),
      })
      .returning();
    const [comment] = await db
      .insert(schema.issueComment)
      .values({ issueId: issue.id, authorId: OWNER, body: 'On it' })
      .returning();
    const [review] = await db
      .insert(schema.pullRequestReview)
      .values({
        pullRequestId: pull.id,
        authorId: OWNER,
        state: 'approved',
        body: 'Ship it',
        commitSha: 'b'.repeat(40),
      })
      .returning();
    const [reviewComment] = await db
      .insert(schema.pullRequestReviewComment)
      .values({
        pullRequestId: pull.id,
        reviewId: review.id,
        authorId: OWNER,
        path: 'src/bell.ts',
        side: 'additions',
        line: 3,
        commitSha: 'b'.repeat(40),
        body: 'Nice',
      })
      .returning();
    const send = (
      id: string,
      event: Parameters<WebhookFanoutService['handle']>[0]['type'],
      payload: Record<string, string>,
    ) =>
      fanout.handle({
        id: `evt_whk_${id}_${RUN}`,
        type: event,
        repositoryId: repository.id,
        actorId: null,
        payload,
        createdAt: new Date(),
      } as Parameters<WebhookFanoutService['handle']>[0]);

    await send('commented', 'issue.commented', {
      issueId: issue.id,
      commentId: comment.id,
    });
    await send('assigned', 'issue.assigned', {
      issueId: issue.id,
      assigneeId: MEMBER,
    });
    await send('reviewed', 'pull_request.reviewed', {
      issueId: pullIssue.id,
      reviewId: review.id,
    });
    await send('review_commented', 'pull_request.review_commented', {
      issueId: pullIssue.id,
      commentId: reviewComment.id,
    });
    // gone before the event was handled
    await send('comment_gone', 'issue.commented', {
      issueId: issue.id,
      commentId: 'ic_gone',
    });
    await send('assignee_gone', 'issue.assigned', {
      issueId: issue.id,
      assigneeId: 'user_gone',
    });
    await send('review_gone', 'pull_request.reviewed', {
      issueId: pullIssue.id,
      reviewId: 'prr_gone',
    });
    await send('review_comment_gone', 'pull_request.review_commented', {
      issueId: pullIssue.id,
      commentId: 'prc_gone',
    });
    await send('issue_gone', 'issue.commented', {
      issueId: 'issue_gone',
      commentId: comment.id,
    });

    const bodies = Object.fromEntries(
      (await jobsFor(webhook.id)).map((job) => [
        (job.payload as { event: string }).event,
        bodyOf(job),
      ]),
    );
    expect(Object.keys(bodies).sort()).toEqual([
      'issue.assigned',
      'issue.commented',
      'ping',
      'pull_request.review_commented',
      'pull_request.reviewed',
    ]);
    expect(bodies['issue.commented']).toMatchObject({
      sender: null,
      issue: { number: 1 },
      comment: { id: comment.id, body: 'On it' },
    });
    expect(bodies['issue.assigned']).toMatchObject({
      assignee: { id: MEMBER, username: `${USERNAME}-member` },
    });
    expect(bodies['pull_request.reviewed']).toMatchObject({
      pullRequest: {
        number: 2,
        htmlUrl: `https://ghost.test/${USERNAME}/app/pulls/2`,
      },
      review: { id: review.id, state: 'approved', body: 'Ship it' },
    });
    expect(bodies['pull_request.review_commented']).toMatchObject({
      comment: { id: reviewComment.id, body: 'Nice', path: 'src/bell.ts' },
    });

    // an event no endpoint chose queues nothing
    const enqueue = vi.spyOn(fanout, 'enqueue');
    await send('reopened', 'issue.reopened', { issueId: issue.id });
    expect(enqueue).not.toHaveBeenCalled();
    enqueue.mockRestore();
  });

  it('describes labels, releases, forks, members and what a deletion carried', async () => {
    const webhook = await webhooks.create(repositoryOwner, {
      url: 'https://93.184.216.34/catalog',
      events: [
        'issue.labeled',
        'issue.comment_deleted',
        'label.deleted',
        'release.published',
        'release.deleted',
        'fork.created',
        'member.added',
        'star.created',
        'repository.transferred',
      ],
    });
    const [label] = await db
      .insert(schema.label)
      .values({ repositoryId: repository.id, name: 'bug', color: 'ff0000' })
      .returning();
    const [release] = await db
      .insert(schema.release)
      .values({ repositoryId: repository.id, tagName: 'v1/rc', name: 'One' })
      .returning();
    const [fork] = await db
      .insert(schema.repository)
      .values({
        name: 'app-fork',
        slug: 'app-fork',
        ownerId: MEMBER,
        visibility: 'public',
        parentRepositoryId: repository.id,
      })
      .returning();
    const send = (
      id: string,
      event: Parameters<WebhookFanoutService['handle']>[0]['type'],
      payload: Record<string, unknown>,
    ) =>
      fanout.handle({
        id: `evt_whk_${id}_${RUN}`,
        type: event,
        repositoryId: repository.id,
        actorId: MEMBER,
        payload,
        createdAt: new Date(),
      } as Parameters<WebhookFanoutService['handle']>[0]);

    await send('labeled', 'issue.labeled', {
      issueId: issue.id,
      labelId: label.id,
    });
    await send('comment_deleted', 'issue.comment_deleted', {
      issueId: issue.id,
      comment: { id: 'ic_deleted', body: 'Never mind' },
    });
    await send('label_deleted', 'label.deleted', {
      label: {
        id: 'label_x',
        name: 'wontfix',
        description: null,
        color: 'ffffff',
      },
    });
    await send('published', 'release.published', { releaseId: release.id });
    await send('release_deleted', 'release.deleted', {
      release: { id: 'release_x', tagName: 'v0', name: null },
    });
    await send('forked', 'fork.created', { forkId: fork.id });
    await send('member_added', 'member.added', { userId: MEMBER });
    await send('starred', 'star.created', {});
    await send('transferred', 'repository.transferred', { from: 'someone' });
    // gone before the event was handled
    await send('label_gone', 'issue.labeled', {
      issueId: issue.id,
      labelId: 'label_gone',
    });
    await send('release_gone', 'release.published', {
      releaseId: 'release_gone',
    });
    await send('fork_gone', 'fork.created', { forkId: 'repo_gone' });
    await send('member_gone', 'member.added', { userId: 'user_gone' });

    const bodies = Object.fromEntries(
      (await jobsFor(webhook.id)).map((job) => [
        (job.payload as { event: string }).event,
        bodyOf(job),
      ]),
    );
    expect(Object.keys(bodies).sort()).toEqual([
      'fork.created',
      'issue.comment_deleted',
      'issue.labeled',
      'label.deleted',
      'member.added',
      'ping',
      'release.deleted',
      'release.published',
      'repository.transferred',
      'star.created',
    ]);
    expect(bodies['issue.labeled']).toMatchObject({
      issue: { number: 1 },
      label: { id: label.id, name: 'bug', color: 'ff0000' },
    });
    expect(bodies['issue.comment_deleted']).toMatchObject({
      issue: { number: 1 },
      comment: { id: 'ic_deleted', body: 'Never mind' },
    });
    expect(bodies['label.deleted'].label).toEqual({
      id: 'label_x',
      name: 'wontfix',
      description: null,
      color: 'ffffff',
    });
    expect(bodies['release.published'].release).toMatchObject({
      id: release.id,
      tagName: 'v1/rc',
      name: 'One',
      isDraft: false,
      htmlUrl: `https://ghost.test/${USERNAME}/app/releases/tag/v1/rc`,
    });
    expect(bodies['release.deleted'].release).toEqual({
      id: 'release_x',
      tagName: 'v0',
      name: null,
    });
    expect(bodies['fork.created']).toMatchObject({
      repository: { fullName: `${USERNAME}/app` },
      fork: {
        id: fork.id,
        fullName: `${USERNAME}-member/app-fork`,
        htmlUrl: `https://ghost.test/${USERNAME}-member/app-fork`,
      },
    });
    expect(bodies['member.added']).toMatchObject({
      member: { id: MEMBER, username: `${USERNAME}-member` },
    });
    expect(bodies['star.created']).toMatchObject({
      sender: { id: MEMBER },
      repository: { fullName: `${USERNAME}/app` },
    });
    expect(bodies['repository.transferred'].from).toBe('someone');
  });

  it('sends a chat service its own message and everyone else Ghost’s JSON', async () => {
    // inserted directly: saving through the API would resolve these hosts
    const [slack, plain] = await db
      .insert(schema.webhookEndpoint)
      .values(
        [
          'https://hooks.slack.com/services/T0/B0/x',
          'https://93.184.216.34/plain',
        ].map((url) => ({
          repositoryId: repository.id,
          url,
          secret: `v1:test-${url}-${RUN}`,
          events: ['star.created'],
        })),
      )
      .returning();
    await fanout.handle({
      id: `evt_whk_star_${RUN}`,
      type: 'star.created',
      repositoryId: repository.id,
      actorId: MEMBER,
      payload: {},
      createdAt: new Date(),
    });

    const [slackJob] = await jobsFor(slack.id);
    expect(bodyOf(slackJob)).toEqual({
      username: 'Ghost',
      icon_url: 'https://ghost.test/icons/icon-192.png',
      text: `[${USERNAME}/app] <https://ghost.test/${USERNAME}/app|${USERNAME}-member starred ${USERNAME}/app>`,
      unfurl_links: false,
    });
    const [plainJob] = await jobsFor(plain.id);
    expect(bodyOf(plainJob)).toMatchObject({
      event: 'star.created',
      sender: { username: `${USERNAME}-member` },
    });
  });

  it('sends a push with its ref and commits', async () => {
    const webhook = await webhooks.create(repositoryOwner, {
      url: 'https://93.184.216.34/push',
      events: ['push'],
    });
    const sha = 'a'.repeat(40);
    await fanout.handle({
      id: `evt_whk_push_${RUN}`,
      type: 'push',
      repositoryId: repository.id,
      actorId: OWNER,
      payload: {
        ref: 'refs/heads/main',
        before: '0'.repeat(40),
        after: sha,
        commits: [
          {
            sha,
            authorName: 'Owner',
            authorEmail: 'owner@example.com',
            committedAt: '2026-09-29T12:00:00.000Z',
            subject: 'Count the bell',
            body: '',
          },
        ],
      },
      createdAt: new Date(),
    });

    const [job] = await jobsFor(webhook.id);
    expect(bodyOf(job)).toMatchObject({
      event: 'push',
      ref: 'refs/heads/main',
      created: true,
      deleted: false,
      repository: { fullName: `${USERNAME}/app` },
      sender: { username: USERNAME },
      commits: [{ sha, subject: 'Count the bell' }],
    });
  });

  it('turns off endpoints that only fail, emails their admins once, and starts fresh when turned back on', async (context) => {
    // The sweeps cover every endpoint in the database; only run where all of them are this suite's.
    const [others] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.webhookEndpoint)
      .where(
        and(
          or(
            isNull(schema.webhookEndpoint.repositoryId),
            ne(schema.webhookEndpoint.repositoryId, repository.id),
          ),
          or(
            isNull(schema.webhookEndpoint.organizationId),
            ne(schema.webhookEndpoint.organizationId, ORGANIZATION),
          ),
        ),
      );
    if (others.total > 0) context.skip();

    // earlier tests' endpoints only hold a pending ping; keep them out of this one
    await db
      .update(schema.webhookEndpoint)
      .set({ active: false })
      .where(
        or(
          eq(schema.webhookEndpoint.repositoryId, repository.id),
          eq(schema.webhookEndpoint.organizationId, ORGANIZATION),
        ),
      );
    const endpoint = async (owner: WebhookOwner, path: string) => {
      const webhook = await webhooks.create(owner, {
        url: `https://93.184.216.34/${path}`,
        events: ['issue.opened'],
      });
      await db
        .update(schema.webhookEndpoint)
        .set({ updatedAt: sql`now() - interval '4 days'` })
        .where(eq(schema.webhookEndpoint.id, webhook.id));
      return webhook.id;
    };
    const finish = (endpointId: string, status: 'dead' | 'succeeded') =>
      db.insert(schema.deliveryJob).values({
        kind: 'webhook',
        idempotencyKey: `webhook:test-breaker-${endpointId}-${status}`,
        endpointId,
        payload: { event: 'issue.opened', body: '{}' },
        status,
      });
    const failing = await endpoint(repositoryOwner, 'failing');
    await finish(failing, 'dead');
    const healthy = await endpoint(repositoryOwner, 'healthy');
    await finish(healthy, 'dead');
    await finish(healthy, 'succeeded');
    const failingOrg = await endpoint(organizationOwner, 'failing-org');
    await finish(failingOrg, 'dead');
    const gone = await endpoint(repositoryOwner, 'gone');
    // what apps/delivery does on a 410
    await db
      .update(schema.webhookEndpoint)
      .set({
        active: false,
        disabledReason: 'The endpoint responded 410 Gone.',
      })
      .where(eq(schema.webhookEndpoint.id, gone));

    const sendWebhookDisabledEmail = vi.fn().mockResolvedValue(undefined);
    const breaker = new WebhookBreakerService(db, {
      sendWebhookDisabledEmail,
    } as unknown as MailService);

    const disabled = await breaker.disableFailingEndpoints();
    expect(disabled.map(({ id }) => id).sort()).toEqual(
      [failing, failingOrg].sort(),
    );
    await breaker.notifyDisabled();
    await breaker.notifyDisabled(); // another API instance sweeping

    const emails = sendWebhookDisabledEmail.mock.calls.map(([to, email]) => [
      to,
      email.owner,
      email.webhookId,
      email.reason,
    ]);
    // the organization's owner hears about its endpoint, its plain member does not
    expect(emails.sort()).toEqual(
      [
        [
          `${USERNAME}@example.com`,
          `${USERNAME}/app`,
          failing,
          'Every delivery failed for three days.',
        ],
        [
          `${USERNAME}@example.com`,
          `${USERNAME}/app`,
          gone,
          'The endpoint responded 410 Gone.',
        ],
        [
          `${USERNAME}@example.com`,
          ORGANIZATION_SLUG,
          failingOrg,
          'Every delivery failed for three days.',
        ],
      ].sort(),
    );
    const [stillOn] = await db
      .select({ active: schema.webhookEndpoint.active })
      .from(schema.webhookEndpoint)
      .where(eq(schema.webhookEndpoint.id, healthy));
    expect(stillOn.active).toBe(true);

    const reenabled = await webhooks.update(repositoryOwner, failing, {
      active: true,
    });
    expect(reenabled).toMatchObject({ active: true, disabledReason: null });
    expect(await breaker.disableFailingEndpoints()).toEqual([]);
    await breaker.notifyDisabled();
    expect(sendWebhookDisabledEmail).toHaveBeenCalledTimes(3);

    // a failed email is logged and the sweep moves on
    await webhooks.update(repositoryOwner, gone, { active: true });
    await db
      .update(schema.webhookEndpoint)
      .set({
        active: false,
        disabledReason: 'The endpoint responded 410 Gone.',
      })
      .where(eq(schema.webhookEndpoint.id, gone));
    sendWebhookDisabledEmail.mockRejectedValueOnce(new Error('relay down'));
    await expect(breaker.sweep()).resolves.toBeUndefined();
  });

  it('lists deliveries with their attempts and redelivers one as a new delivery', async () => {
    const webhook = await webhooks.create(repositoryOwner, {
      url: 'https://93.184.216.34/again',
      events: ['issue.opened'],
    });
    await db
      .update(schema.deliveryJob)
      .set({ status: 'dead' })
      .where(eq(schema.deliveryJob.endpointId, webhook.id));
    await db.insert(schema.deliveryAttempt).values({
      jobId: (await jobsFor(webhook.id))[0].id,
      durationMs: 12,
      statusCode: 500,
      requestHeaders: { 'X-Ghost-Event': 'ping' },
      responseBody: 'boom',
    });

    const { deliveries } = await webhooks.deliveries(
      repositoryOwner,
      webhook.id,
    );
    expect(deliveries).toEqual([
      expect.objectContaining({
        event: 'ping',
        status: 'dead',
        nextAttemptAt: null,
        attempts: [
          expect.objectContaining({
            durationMs: 12,
            statusCode: 500,
            error: null,
            requestHeaders: { 'X-Ghost-Event': 'ping' },
            responseBody: 'boom',
          }),
        ],
      }),
    ]);

    await webhooks.redeliver(repositoryOwner, webhook.id, deliveries[0].id);
    const after = await webhooks.deliveries(repositoryOwner, webhook.id);
    expect(after.deliveries).toHaveLength(2);
    expect(after.deliveries[0]).toMatchObject({
      status: 'pending',
      body: deliveries[0].body,
      nextAttemptAt: expect.any(String),
      attempts: [],
    });
    expect(after.deliveries[0].id).not.toBe(deliveries[0].id);
    await expect(
      webhooks.redeliver(repositoryOwner, webhook.id, MISSING_DELIVERY),
    ).rejects.toThrow('Delivery not found');
  });

  it('pings and deletes', async () => {
    const webhook = await webhooks.create(repositoryOwner, {
      url: 'https://93.184.216.34/bye',
      events: ['issue.opened'],
    });
    await webhooks.ping(repositoryOwner, webhook.id);
    expect(await eventsFor(webhook.id)).toEqual(['ping', 'ping']);

    await webhooks.remove(repositoryOwner, webhook.id);
    expect(await jobsFor(webhook.id)).toEqual([]);
    await expect(webhooks.ping(repositoryOwner, webhook.id)).rejects.toThrow(
      'Webhook not found',
    );
  });

  it('refuses to create webhooks without WEBHOOK_SECRET_KEY', async () => {
    const unconfigured = new WebhooksService(
      db,
      new RepositoryAccessService(db),
      fanout,
      { get: () => undefined } as unknown as ConfigService,
    );
    await expect(
      unconfigured.create(repositoryOwner, {
        url: 'https://93.184.216.34/none',
        events: ['issue.opened'],
      }),
    ).rejects.toThrow('WEBHOOK_SECRET_KEY');
  });
});
