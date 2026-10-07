import type { Readable } from 'node:stream';
import { type Database, schema } from '@ghost/db';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, eq, isNotNull, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import {
  ATTACHMENT_EXTENSIONS,
  ATTACHMENT_MAX_BYTES,
  attachmentKey,
  attachmentTypeOf,
} from '../../lib/attachments/attachments.js';
import { isValidAssetName } from '../../lib/releases/release-assets.js';
import { formatByteSize } from '../../lib/storage/byte-size.js';
import { RESERVATION_TTL } from '../../lib/storage/reservation.js';
import { ContentLengthRequiredError } from '../../lib/storage/storage.errors.js';
import { InvalidAssetNameError } from '../../lib/releases/releases.errors.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { S3Service } from '../../services/s3/s3.service.js';
import { StorageQuotaService } from '../../services/storage/storage-quota.service.js';
import {
  AttachmentNotFoundError,
  AttachmentNotOctetStreamError,
  AttachmentTooLargeError,
  AttachmentTypeNotAllowedError,
} from '../../lib/attachments/attachments.errors.js';
import { errorMessage } from '../../lib/error-message.js';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const SWEEP_BATCH = 100;

const attachmentColumns = {
  id: schema.attachment.id,
  name: schema.attachment.name,
  contentType: schema.attachment.contentType,
  size: schema.attachment.size,
};

/** Files dropped into issue, pull request, comment and release text. Bytes stream straight from the request to object storage and back. */
@Injectable()
export class AttachmentsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(AttachmentsService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: RepositoryAccessService,
    private readonly s3: S3Service,
    private readonly quota: StorageQuotaService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => {
      this.sweep().catch((error: unknown) =>
        this.logger.error(`Attachment sweep failed: ${errorMessage(error)}`),
      );
    }, SWEEP_INTERVAL_MS);
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  /** Anyone who can read the repository may attach, since anyone who can read it may comment. The uploader pays for the bytes. */
  async upload({
    username,
    repo,
    requesterId,
    name,
    bodyType,
    contentLength,
    body,
  }: {
    username: string;
    repo: string;
    requesterId: string;
    name: string;
    /** The request's own `Content-Type`. */
    bodyType: string | undefined;
    contentLength: string | undefined;
    body: Readable;
  }) {
    const repository = await this.access.authorize({
      username,
      repo,
      requesterId: requesterId,
      operation: 'read',
    });
    // JSON and form bodies are parsed before any handler runs, so their bytes are gone by the time they could be streamed
    if (bodyType?.split(';')[0]?.trim() !== 'application/octet-stream') {
      throw new AttachmentNotOctetStreamError();
    }
    const fileName = name.trim();
    if (!isValidAssetName(fileName)) throw new InvalidAssetNameError(name);
    const contentType = attachmentTypeOf(fileName);
    if (!contentType) {
      throw new AttachmentTypeNotAllowedError(fileName, ATTACHMENT_EXTENSIONS);
    }

    const size = Number(contentLength);
    if (!contentLength || !Number.isSafeInteger(size) || size <= 0) {
      throw new ContentLengthRequiredError();
    }
    if (size > ATTACHMENT_MAX_BYTES) {
      throw new AttachmentTooLargeError(formatByteSize(ATTACHMENT_MAX_BYTES));
    }

    const [reserved] = await this.quota.reserve(
      { userId: requesterId },
      'asset',
      size,
      (tx) =>
        tx
          .insert(schema.attachment)
          .values({
            repositoryId: repository.id,
            name: fileName,
            contentType,
            size,
            uploaderId: requesterId,
          })
          .returning({ id: schema.attachment.id }),
    );

    const key = attachmentKey(repository.id, reserved.id);
    try {
      await this.s3.putStream({
        Key: key,
        Body: body,
        ContentLength: size,
        ContentType: 'application/octet-stream',
      });
    } catch (error) {
      await this.db
        .delete(schema.attachment)
        .where(eq(schema.attachment.id, reserved.id));
      throw error;
    }

    const [uploaded] = await this.db
      .update(schema.attachment)
      .set({ uploadedAt: new Date() })
      .where(eq(schema.attachment.id, reserved.id))
      .returning(attachmentColumns);
    // the repository was deleted while the bytes were in flight, taking the row with it
    if (!uploaded) {
      await this.s3.deleteObject({ Bucket: this.s3.bucket, Key: key });
      throw new AttachmentNotFoundError();
    }
    return uploaded;
  }

  /** Readable by whoever can read the repository it was attached in, so a private repository's attachments stay private. */
  async download({
    attachmentId,
    requesterId,
  }: {
    attachmentId: string;
    requesterId?: string;
  }) {
    const [attachment] = await this.db
      .select({
        ...attachmentColumns,
        repositoryId: schema.attachment.repositoryId,
      })
      .from(schema.attachment)
      .where(
        and(
          eq(schema.attachment.id, attachmentId),
          isNotNull(schema.attachment.uploadedAt),
        ),
      );
    if (!attachment) throw new AttachmentNotFoundError();

    await this.access.authorizeById({
      repositoryId: attachment.repositoryId,
      requesterId,
      operation: 'read',
    });

    const object = await this.s3.getObject({
      Bucket: this.s3.bucket,
      Key: attachmentKey(attachment.repositoryId, attachment.id),
    });
    if (!object.Body) throw new AttachmentNotFoundError();

    return { ...attachment, stream: object.Body as Readable };
  }

  /** Removes attachments no text in their repository mentions once they are a day old: uploads never posted, and those whose comment was edited away or deleted. The grace day covers a draft still being written. */
  async sweep() {
    // ponytail: scans each candidate's repository text with strpos; index attachment references if repositories grow past what a seq scan per hour can take.
    const mentionedIn = (from: string, repositoryId: string) =>
      sql.raw(
        `exists (select 1 from ${from} where ${repositoryId} = a.repository_id and strpos(t.body, a.id) > 0)`,
      );
    const reviewed =
      'join pull_request p on p.id = t.pull_request_id join issue i on i.id = p.issue_id';
    const { rows } = await this.db.execute<{
      id: string;
      repository_id: string;
    }>(sql`
      select a.id, a.repository_id from ${schema.attachment} a
      where a.created_at < now() - ${RESERVATION_TTL}
        and (a.uploaded_at is null or not (
          ${mentionedIn('issue t', 't.repository_id')}
          or ${mentionedIn('issue_comment t join issue i on i.id = t.issue_id', 'i.repository_id')}
          or ${mentionedIn(`pull_request_review t ${reviewed}`, 'i.repository_id')}
          or ${mentionedIn(`pull_request_review_comment t ${reviewed}`, 'i.repository_id')}
          or ${mentionedIn('release t', 't.repository_id')}
        ))
      limit ${SWEEP_BATCH}
    `);

    for (const row of rows) {
      // bytes first: a row left without its object is swept again, an object left without its row would be kept forever
      await this.s3.deleteObject({
        Bucket: this.s3.bucket,
        Key: attachmentKey(row.repository_id, row.id),
      });
      await this.db
        .delete(schema.attachment)
        .where(eq(schema.attachment.id, row.id));
    }
    return rows.length;
  }
}
