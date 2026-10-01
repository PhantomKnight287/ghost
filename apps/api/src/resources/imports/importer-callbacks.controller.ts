import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '@thallesp/nestjs-better-auth';

import { ImportDispatcherService } from '../../services/imports/import-dispatcher.service.js';
import { ImportWriterService } from '../../services/imports/import-writer.service.js';
import {
  FinishImportRequestDTO,
  ImportAttemptDTO,
  ImportCommentsRequestDTO,
  ImportIssuesRequestDTO,
  ImportReleasesRequestDTO,
} from './dto/importer-callback.dto.js';
import { ImporterSecretGuard } from './importer-secret.guard.js';

/** Called by `apps/importer` only. Each call renews the attempt's lease, so a working importer never looks silent. */
@Controller('internal/imports/:importId')
@ApiExcludeController()
@Public()
@UseGuards(ImporterSecretGuard)
export class ImporterCallbacksController {
  constructor(
    private readonly dispatcher: ImportDispatcherService,
    private readonly writer: ImportWriterService,
  ) {}

  @Post('heartbeat')
  @HttpCode(HttpStatus.NO_CONTENT)
  async heartbeat(
    @Param('importId') importId: string,
    @Body() { attempt }: ImportAttemptDTO,
  ) {
    await this.dispatcher.renewLease(importId, attempt);
  }

  @Post('releases')
  @HttpCode(HttpStatus.NO_CONTENT)
  async releases(
    @Param('importId') importId: string,
    @Body() { attempt, releases }: ImportReleasesRequestDTO,
  ) {
    const repositoryId = await this.dispatcher.renewLease(importId, attempt);
    await this.writer.writeReleases(repositoryId, releases);
  }

  @Post('issues')
  @HttpCode(HttpStatus.NO_CONTENT)
  async issues(
    @Param('importId') importId: string,
    @Body() { attempt, issues }: ImportIssuesRequestDTO,
  ) {
    const repositoryId = await this.dispatcher.renewLease(importId, attempt);
    await this.writer.writeIssues(repositoryId, issues);
  }

  @Post('comments')
  @HttpCode(HttpStatus.NO_CONTENT)
  async comments(
    @Param('importId') importId: string,
    @Body() { attempt, comments }: ImportCommentsRequestDTO,
  ) {
    const repositoryId = await this.dispatcher.renewLease(importId, attempt);
    await this.writer.writeComments(repositoryId, comments);
  }

  @Post('finish')
  @HttpCode(HttpStatus.NO_CONTENT)
  async finish(
    @Param('importId') importId: string,
    @Body() body: FinishImportRequestDTO,
  ) {
    await this.dispatcher.settle(
      importId,
      body.attempt,
      body.succeeded
        ? { succeeded: true, defaultBranch: body.defaultBranch ?? null }
        : { succeeded: false, error: body.error!, retryable: body.retryable! },
    );
  }
}
