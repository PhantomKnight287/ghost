import { randomBytes } from 'node:crypto';
import { createDatabase, type Database, type Pool, schema } from '@ghost/db';
import type { ConfigService } from '@nestjs/config';
import { desc, eq, ne, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { WebhookBreakerService } from '../../services/webhooks/webhook-breaker.service.js';
import { WebhookFanoutService } from '../../services/webhooks/webhook-fanout.service.js';
import type { MailService } from '../../mail/mail.service.js';
import { InvalidWebhookUrlError } from './webhooks.errors.js';
import { WebhooksService } from './webhooks.service.js';

const CONNECTION = process.env.TEST_DATABASE_URL;
const RUN = Date.now().toString(36);
const OWNER = `user_whk_${RUN}`;
const USERNAME = `whk-${RUN}`;

// Touches only the user it creates; deleting that user cascades to the repository, its issue, endpoints and jobs.
describe.skipIf(!CONNECTION)('webhooks', () => {
  let db: Database;
  let pool: Pool;
  let fanout: WebhookFanoutService;
  let webhooks: WebhooksService;
  let repository: typeof schema.repository.$inferSelect;
  let issue: typeof schema.issue.$inferSelect;
  const ref = { username: USERNAME, repo: 'app', requesterId: OWNER };

  const jobsFor = (endpointId: string) =>
    db
      .select()
      .from(schema.deliveryJob)
      .where(eq(schema.deliveryJob.endpointId, endpointId))
      .orderBy(desc(schema.deliveryJob.createdAt));

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

    await db.insert(schema.user).values({
      id: OWNER,
      name: 'Webhook owner',
      email: `${USERNAME}@example.com`,
      username: USERNAME,
      emailVerified: true,
    });
    [repository] = await db
      .insert(schema.repository)
      .values({
        name: 'app',
        slug: 'app',
        ownerId: OWNER,
        visibility: 'public',
      })
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
  });

  afterAll(async () => {
    await db.delete(schema.user).where(eq(schema.user.id, OWNER));
    await pool?.end();
  });

  it('creates an endpoint, returns its secret once, and pings it', async () => {
    const created = await webhooks.create({
      ...ref,
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
    expect(ping.kind).toBe('webhook');
    const payload = ping.payload as { event: string; body: string };
    expect(payload.event).toBe('ping');
    expect(JSON.parse(payload.body)).toMatchObject({
      repository: { full_name: `${USERNAME}/app` },
    });

    const listed = await webhooks.list(ref);
    expect(listed.webhooks.map((webhook) => webhook.id)).toContain(created.id);
    expect(listed.webhooks[0]).not.toHaveProperty('secret');
  });

  it('refuses a URL that points inside the network', async () => {
    await expect(
      webhooks.create({
        ...ref,
        url: 'http://127.0.0.1:9000',
        events: ['issue.opened'],
      }),
    ).rejects.toBeInstanceOf(InvalidWebhookUrlError);
  });

  it('fans an event out once to the endpoints that chose it', async () => {
    const wanted = await webhooks.create({
      ...ref,
      url: 'https://93.184.216.34/wanted',
      events: ['issue.opened'],
    });
    const other = await webhooks.create({
      ...ref,
      url: 'https://93.184.216.34/other',
      events: ['issue.closed'],
    });
    const event = {
      id: `evt_whk_${RUN}`,
      type: 'issue.opened' as const,
      repositoryId: repository.id,
      actorId: OWNER,
      payload: { issueId: issue.id },
      createdAt: new Date(),
    };

    await fanout.handle(event);
    await fanout.handle(event); // a retried outbox event

    const jobs = (await jobsFor(wanted.id)).filter(
      (job) => (job.payload as { event: string }).event === 'issue.opened',
    );
    expect(jobs).toHaveLength(1);
    const body = JSON.parse((jobs[0].payload as { body: string }).body);
    expect(body).toMatchObject({
      event: 'issue.opened',
      repository: { full_name: `${USERNAME}/app` },
      sender: { username: USERNAME },
      issue: {
        number: 1,
        title: 'Bell count',
        html_url: `https://ghost.test/${USERNAME}/app/issues/1`,
      },
    });
    expect(
      (await jobsFor(other.id)).map(
        (job) => (job.payload as { event: string }).event,
      ),
    ).toEqual(['ping']);
  });

  it('sends a push with its ref and commits', async () => {
    const webhook = await webhooks.create({
      ...ref,
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
            message: 'Count the bell',
            author: { name: 'Owner', email: 'owner@example.com' },
            timestamp: '2026-09-29T12:00:00.000Z',
          },
        ],
      },
      createdAt: new Date(),
    });

    const [job] = (await jobsFor(webhook.id)).filter(
      (job) => (job.payload as { event: string }).event === 'push',
    );
    expect(JSON.parse((job.payload as { body: string }).body)).toMatchObject({
      event: 'push',
      ref: 'refs/heads/main',
      created: true,
      deleted: false,
      repository: { full_name: `${USERNAME}/app` },
      sender: { username: USERNAME },
      commits: [
        {
          sha,
          message: 'Count the bell',
          html_url: `https://ghost.test/${USERNAME}/app/commit/${sha}`,
        },
      ],
    });
  });

  it('turns off an endpoint that only failed for three days and emails the owner', async (context) => {
    // The sweep covers every endpoint; only run where all of them are this test's.
    const [others] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.webhookEndpoint)
      .where(ne(schema.webhookEndpoint.repositoryId, repository.id));
    if (others.total > 0) context.skip();

    const endpoint = async (path: string, finished: 'dead' | 'succeeded') => {
      const webhook = await webhooks.create({
        ...ref,
        url: `https://93.184.216.34/${path}`,
        events: ['issue.opened'],
      });
      await db
        .update(schema.webhookEndpoint)
        .set({ updatedAt: sql`now() - interval '4 days'` })
        .where(eq(schema.webhookEndpoint.id, webhook.id));
      await db.insert(schema.deliveryJob).values({
        kind: 'webhook',
        idempotencyKey: `webhook:test-breaker-${path}-${RUN}`,
        endpointId: webhook.id,
        payload: { event: 'issue.opened', body: '{}' },
        status: finished,
      });
      return webhook.id;
    };
    const failing = await endpoint('failing', 'dead');
    const healthy = await endpoint('healthy', 'succeeded');
    await db.insert(schema.deliveryJob).values({
      kind: 'webhook',
      idempotencyKey: `webhook:test-breaker-healthy-dead-${RUN}`,
      endpointId: healthy,
      payload: { event: 'issue.opened', body: '{}' },
      status: 'dead',
    });

    const sendWebhookDisabledEmail = vi.fn().mockResolvedValue(undefined);
    const breaker = new WebhookBreakerService(db, {
      sendWebhookDisabledEmail,
    } as unknown as MailService);
    const disabled = await breaker.disableFailingEndpoints();

    expect(disabled.map((webhook) => webhook.id)).toEqual([failing]);
    const [row] = await db
      .select()
      .from(schema.webhookEndpoint)
      .where(eq(schema.webhookEndpoint.id, failing));
    expect(row).toMatchObject({
      active: false,
      disabledReason: 'Every delivery failed for three days.',
    });
    expect(sendWebhookDisabledEmail).toHaveBeenCalledWith(
      `${USERNAME}@example.com`,
      expect.objectContaining({
        repository: `${USERNAME}/app`,
        webhookId: failing,
      }),
    );

    // turning it back on is a fresh start: the old failure does not turn it off again
    await webhooks.update({ ...ref, webhookId: failing, active: true });
    expect(await breaker.disableFailingEndpoints()).toEqual([]);
  });

  it('turns a disabled endpoint back on and redelivers as a new delivery', async () => {
    const webhook = await webhooks.create({
      ...ref,
      url: 'https://93.184.216.34/again',
      events: ['issue.opened'],
    });
    await db
      .update(schema.webhookEndpoint)
      .set({
        active: false,
        disabledReason: 'The endpoint responded 410 Gone.',
      })
      .where(eq(schema.webhookEndpoint.id, webhook.id));

    const updated = await webhooks.update({
      ...ref,
      webhookId: webhook.id,
      active: true,
    });
    expect(updated).toMatchObject({ active: true, disabledReason: null });

    const { deliveries } = await webhooks.deliveries({
      ...ref,
      webhookId: webhook.id,
    });
    expect(deliveries).toHaveLength(1);
    await webhooks.redeliver({
      ...ref,
      webhookId: webhook.id,
      deliveryId: deliveries[0].id,
    });
    const after = await webhooks.deliveries({ ...ref, webhookId: webhook.id });
    expect(after.deliveries).toHaveLength(2);
    expect(after.deliveries[0].id).not.toBe(deliveries[0].id);
    expect(after.deliveries[0].body).toBe(deliveries[0].body);
  });
});
