import type { Readable } from 'node:stream';

import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';

import { DATABASE } from '../../../database/database.module.js';
import {
  GithubNotFoundError,
  RequiresAuthenticationError,
} from '../../../lib/github/github.errors.js';
import { githubOrigins } from '../../../lib/github/origins.js';
import { WRITE_OR_ABOVE } from '../../../lib/github/permission.js';
import { AttachmentsService } from '../../../resources/attachments/attachments.service.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { requireWriteScope } from '../../auth/require-scopes.js';
import { RepositoryNodesService } from '../../graphql/resolvers/repository/repository-nodes.service.js';
import type {
  GithubUploadUserAttachmentQueryDTO,
  GithubUserAttachmentDTO,
} from './dto/user-attachment.dto.js';

/** GitHub's `--attach` upload over AttachmentsService. GitHub answers 404 to a caller who cannot write, so Ghost does too. */
@Injectable()
export class GithubUserAttachmentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly repositories: RepositoryNodesService,
    private readonly attachments: AttachmentsService,
  ) {}

  async upload(
    viewer: GithubViewer | null,
    query: GithubUploadUserAttachmentQueryDTO,
    file: {
      type: string | undefined;
      length: string | undefined;
      body: Readable;
    },
  ): Promise<GithubUserAttachmentDTO> {
    if (!viewer) throw new RequiresAuthenticationError();
    const [row] = await this.db
      .select({ id: schema.repository.id })
      .from(schema.repository)
      .where(eq(schema.repository.numericId, query.repository_id));
    if (!row) throw new GithubNotFoundError();
    const repository = await this.repositories.load(row.id, viewer);
    if (!WRITE_OR_ABOVE.includes(repository.viewerPermission))
      throw new GithubNotFoundError();
    requireWriteScope(viewer, 'POST /user-attachments/assets', repository);

    const attachment = await this.attachments.upload({
      username: repository.ownerLogin,
      repo: repository.slug,
      requesterId: viewer.userId,
      name: query.name,
      bodyType: file.type,
      contentLength: file.length,
      body: file.body,
    });
    return {
      id: attachment.id,
      name: attachment.name,
      size: attachment.size,
      content_type: attachment.contentType,
      url: `${githubOrigins(this.config).api}/api/attachments/${attachment.id}`,
    };
  }
}
