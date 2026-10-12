import { Injectable } from '@nestjs/common';

import { ImportDispatcherService } from '../../services/imports/import-dispatcher.service.js';
import { ImportWriterService } from '../../services/imports/import-writer.service.js';
import type {
  FinishImportRequestDTO,
  ImportCommentsRequestDTO,
  ImportIssuesRequestDTO,
  ImportReleasesRequestDTO,
} from './dto/importer-callback.dto.js';

/** What `apps/importer` reports back. Each report renews the attempt's lease first, so a working importer never looks silent and a stale attempt writes nothing. */
@Injectable()
export class ImporterCallbacksService {
  constructor(
    private readonly dispatcher: ImportDispatcherService,
    private readonly writer: ImportWriterService,
  ) {}

  async heartbeat(importId: string, attempt: string) {
    await this.dispatcher.renewLease(importId, attempt);
  }

  async releases(
    importId: string,
    { attempt, releases }: ImportReleasesRequestDTO,
  ) {
    const repositoryId = await this.dispatcher.renewLease(importId, attempt);
    await this.writer.writeReleases(repositoryId, releases);
  }

  async issues(importId: string, { attempt, issues }: ImportIssuesRequestDTO) {
    const repositoryId = await this.dispatcher.renewLease(importId, attempt);
    await this.writer.writeIssues(repositoryId, issues);
  }

  async comments(
    importId: string,
    { attempt, comments }: ImportCommentsRequestDTO,
  ) {
    const repositoryId = await this.dispatcher.renewLease(importId, attempt);
    await this.writer.writeComments(repositoryId, comments);
  }

  finish(importId: string, body: FinishImportRequestDTO) {
    return this.dispatcher.settle(
      importId,
      body.attempt,
      body.succeeded
        ? { succeeded: true, defaultBranch: body.defaultBranch ?? null }
        : { succeeded: false, error: body.error!, retryable: body.retryable! },
    );
  }
}
