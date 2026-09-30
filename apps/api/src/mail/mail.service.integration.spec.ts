import { createDatabase, type Database, type Pool, schema } from '@ghost/db';
import type { ConfigService } from '@nestjs/config';
import type { MailerService } from '@nestjs-modules/mailer';
import { like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import ThreadComment from './templates/thread-comment.js';
import { MailService } from './mail.service.js';

const CONNECTION = process.env.TEST_DATABASE_URL;
const KEY = `test-mail-${Date.now()}`;

// Touches only the delivery_job rows it inserts, so it can share a dev database.
describe.skipIf(!CONNECTION)('queued thread emails', () => {
  let db: Database;
  let pool: Pool;

  beforeAll(() => {
    ({ db, pool } = createDatabase({ connectionString: CONNECTION }));
  });

  afterAll(async () => {
    await db
      .delete(schema.deliveryJob)
      .where(like(schema.deliveryJob.idempotencyKey, `email:${KEY}%`));
    await pool.end();
  });

  it('render once into a delivery job instead of sending', async () => {
    const sendMail = vi.fn();
    const config = {
      get: (name: string) => (name === 'DELIVERY_EMAIL' ? 'queue' : undefined),
    } as unknown as ConfigService;
    const mail = new MailService(
      { sendMail } as unknown as MailerService,
      config,
      db,
    );
    const { appUrl: _, ...context } = ThreadComment.PreviewProps;
    const email = {
      template: 'thread-comment' as const,
      threadId: 'issue_1',
      subject: '[alice/ghost] Bell count (#42)',
      context,
      idempotencyKey: KEY,
    };

    await mail.sendThreadEmail('bob@example.com', email);
    await mail.sendThreadEmail('bob@example.com', email); // a retried outbox event

    expect(sendMail).not.toHaveBeenCalled();
    const jobs = await db
      .select()
      .from(schema.deliveryJob)
      .where(like(schema.deliveryJob.idempotencyKey, `email:${KEY}%`));
    expect(jobs).toHaveLength(1);
    expect(jobs[0].kind).toBe('email');
    const payload = jobs[0].payload as Record<string, string>;
    expect(payload.to).toBe('bob@example.com');
    expect(payload.subject).toBe(email.subject);
    expect(payload.html).toContain('<html');
    expect(payload.text).toContain('bob commented:');
    expect(payload.text).toContain(
      'http://localhost:3000/alice/ghost/issues/42',
    );
  });
});
