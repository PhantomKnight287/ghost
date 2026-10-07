import path from 'node:path';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { createDatabase, type Database, type Pool, schema } from '@ghost/db';
import { ConfigService } from '@nestjs/config';
import { eq, inArray, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryS3 } from '../../lib/s3/s3.fake.js';
import {
  ContentLengthRequiredError,
  StorageQuotaExceededError,
} from '../../lib/storage/storage.errors.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import type { S3Service } from '../../services/s3/s3.service.js';
import { StorageQuotaService } from '../../services/storage/storage-quota.service.js';
import { RepositoryNotFoundError } from '../repositories/repositories.errors.js';
import { InvalidAssetNameError } from '../releases/releases.errors.js';
import {
  AttachmentNotFoundError,
  AttachmentNotOctetStreamError,
  AttachmentTooLargeError,
  AttachmentTypeNotAllowedError,
} from './attachments.errors.js';
import { AttachmentsService } from './attachments.service.js';

const CONNECTION = process.env.TEST_DATABASE_URL;
const MIGRATIONS = path.resolve(
  import.meta.dirname,
  '../../../../../packages/db/drizzle',
);

const OWNER = 'user_attachment_owner';
const VISITOR = 'user_attachment_visitor';

// Needs a throwaway Postgres; the suite is skipped without one.
describe.skipIf(!CONNECTION)('attachments', () => {
  let db: Database;
  let pool: Pool;
  let s3: InMemoryS3;
  let quota: StorageQuotaService;
  let attachments: AttachmentsService;
  let repository: typeof schema.repository.$inferSelect;

  function limits(env: Record<string, string>) {
    quota = new StorageQuotaService(db, new ConfigService(env));
    attachments = new AttachmentsService(
      db,
      new RepositoryAccessService(db),
      s3 as unknown as S3Service,
      quota,
    );
  }

  function upload(
    name: string,
    bytes: Buffer,
    {
      requesterId = VISITOR,
      repo = 'app',
      bodyType = 'application/octet-stream',
      contentLength = String(bytes.length),
    }: Partial<{
      requesterId: string;
      repo: string;
      bodyType: string;
      contentLength: string;
    }> = {},
  ) {
    return attachments.upload({
      username: 'attachment-owner',
      repo,
      requesterId,
      name,
      bodyType,
      contentLength,
      body: Readable.from([bytes]),
    });
  }

  /** Makes an attachment old enough for the sweep to consider. */
  function age(id: string) {
    return db
      .update(schema.attachment)
      .set({ createdAt: sql`now() - interval '2 days'` })
      .where(eq(schema.attachment.id, id));
  }

  beforeAll(async () => {
    ({ db, pool } = createDatabase({ connectionString: CONNECTION }));
    await migrate(db, { migrationsFolder: MIGRATIONS });
  });

  beforeEach(async () => {
    s3 = new InMemoryS3();
    limits({});
    await db
      .delete(schema.user)
      .where(inArray(schema.user.id, [OWNER, VISITOR]));
    await db.insert(schema.user).values([
      {
        id: OWNER,
        name: 'Owner',
        email: 'attachment-owner@example.com',
        username: 'attachment-owner',
      },
      {
        id: VISITOR,
        name: 'Visitor',
        email: 'attachment-visitor@example.com',
        username: 'attachment-visitor',
      },
    ]);
    [repository] = await db
      .insert(schema.repository)
      .values({
        name: 'app',
        slug: 'app',
        ownerId: OWNER,
        visibility: 'public',
      })
      .returning();
  });

  afterAll(async () => {
    await db
      .delete(schema.user)
      .where(inArray(schema.user.id, [OWNER, VISITOR]));
    await pool?.end();
  });

  it('stores a file anyone who can read the repository may attach, and serves it back by id', async () => {
    const attachment = await upload('Screen Shot.png', Buffer.from('png'));

    expect(attachment).toMatchObject({
      name: 'Screen Shot.png',
      contentType: 'image/png',
      size: 3,
    });
    const served = await attachments.download({ attachmentId: attachment.id });
    expect(served.contentType).toBe('image/png');
    expect((await buffer(served.stream)).toString()).toBe('png');
  });

  it("keeps a private repository's attachments to those who can read it", async () => {
    const [hidden] = await db
      .insert(schema.repository)
      .values({
        name: 'hidden',
        slug: 'hidden',
        ownerId: OWNER,
        visibility: 'private',
      })
      .returning();
    const attachment = await upload('notes.txt', Buffer.from('secret'), {
      requesterId: OWNER,
      repo: hidden.slug,
    });

    await expect(
      upload('notes.txt', Buffer.from('x'), { repo: hidden.slug }),
    ).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(
      attachments.download({
        attachmentId: attachment.id,
        requesterId: VISITOR,
      }),
    ).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(
      attachments.download({ attachmentId: attachment.id }),
    ).rejects.toThrow('Authentication required');
    await expect(
      attachments.download({ attachmentId: attachment.id, requesterId: OWNER }),
    ).resolves.toMatchObject({ name: 'notes.txt' });
  });

  it('refuses files it would serve as something runnable, paths, bodies it cannot stream and oversized files', async () => {
    await expect(
      upload('page.html', Buffer.from('<script>')),
    ).rejects.toBeInstanceOf(AttachmentTypeNotAllowedError);
    await expect(
      upload('logo.svg', Buffer.from('<svg/>')),
    ).rejects.toBeInstanceOf(AttachmentTypeNotAllowedError);
    await expect(upload('../a.png', Buffer.from('x'))).rejects.toBeInstanceOf(
      InvalidAssetNameError,
    );
    await expect(
      upload('a.png', Buffer.from('x'), { bodyType: 'application/json' }),
    ).rejects.toBeInstanceOf(AttachmentNotOctetStreamError);
    await expect(
      upload('a.png', Buffer.from('x'), { contentLength: '' }),
    ).rejects.toBeInstanceOf(ContentLengthRequiredError);
    await expect(
      upload('a.png', Buffer.from('x'), {
        contentLength: String(26 * 1024 ** 2),
      }),
    ).rejects.toBeInstanceOf(AttachmentTooLargeError);
    expect(
      await db
        .select()
        .from(schema.attachment)
        .where(eq(schema.attachment.repositoryId, repository.id)),
    ).toEqual([]);
  });

  it("bills the uploader's asset quota, not the repository owner's", async () => {
    limits({ ASSET_STORAGE_QUOTA_BYTES: '10' });

    await upload('a.txt', Buffer.alloc(8));
    await expect(upload('b.txt', Buffer.alloc(8))).rejects.toBeInstanceOf(
      StorageQuotaExceededError,
    );
    expect(await quota.usageOf({ userId: VISITOR }, 'asset')).toBe(8);
    expect(await quota.usageOf({ userId: OWNER }, 'asset')).toBe(0);
    await expect(
      upload('c.txt', Buffer.alloc(8), { requesterId: OWNER }),
    ).resolves.toMatchObject({ size: 8 });
  });

  it('frees the reservation when the bytes never arrive', async () => {
    s3.failNextPut = true;
    await expect(upload('a.txt', Buffer.from('x'))).rejects.toThrow(
      'connection reset',
    );
    expect(await quota.usageOf({ userId: VISITOR }, 'asset')).toBe(0);
  });

  it('sweeps day-old attachments no text in their repository mentions, and keeps the rest', async () => {
    const [issue] = await db
      .insert(schema.issue)
      .values({
        repositoryId: repository.id,
        number: 1,
        title: 'Bug',
        authorId: VISITOR,
      })
      .returning();
    const inBody = await upload('body.png', Buffer.from('1'));
    const inComment = await upload('comment.png', Buffer.from('2'));
    const inRelease = await upload('release.zip', Buffer.from('3'));
    const orphan = await upload('orphan.png', Buffer.from('4'));
    const fresh = await upload('fresh.png', Buffer.from('5'));

    await db
      .update(schema.issue)
      .set({
        body: `![body](https://api.example.com/api/attachments/${inBody.id})`,
      })
      .where(eq(schema.issue.id, issue.id));
    await db.insert(schema.issueComment).values({
      issueId: issue.id,
      authorId: VISITOR,
      body: `[log](/api/attachments/${inComment.id})`,
    });
    await db.insert(schema.release).values({
      repositoryId: repository.id,
      tagName: 'v1',
      body: `/api/attachments/${inRelease.id}`,
    });
    for (const { id } of [inBody, inComment, inRelease, orphan]) await age(id);

    expect(await attachments.sweep()).toBe(1);

    const left = await db
      .select({ id: schema.attachment.id })
      .from(schema.attachment)
      .where(eq(schema.attachment.repositoryId, repository.id));
    expect(left.map((row) => row.id).sort()).toEqual(
      [inBody.id, inComment.id, inRelease.id, fresh.id].sort(),
    );
    await expect(
      attachments.download({ attachmentId: orphan.id }),
    ).rejects.toBeInstanceOf(AttachmentNotFoundError);
    expect([...s3.objects.keys()].some((key) => key.endsWith(orphan.id))).toBe(
      false,
    );
  });

  it('does not count an attachment in another repository as a mention', async () => {
    const [other] = await db
      .insert(schema.repository)
      .values({
        name: 'other',
        slug: 'other',
        ownerId: OWNER,
        visibility: 'public',
      })
      .returning();
    const attachment = await upload('a.png', Buffer.from('1'));
    await db.insert(schema.issue).values({
      repositoryId: other.id,
      number: 1,
      title: 'Elsewhere',
      body: `/api/attachments/${attachment.id}`,
      authorId: VISITOR,
    });
    await age(attachment.id);

    expect(await attachments.sweep()).toBe(1);
  });
});
