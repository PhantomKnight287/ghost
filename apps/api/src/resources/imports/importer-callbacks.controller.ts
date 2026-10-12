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

import {
  FinishImportRequestDTO,
  ImportAttemptDTO,
  ImportCommentsRequestDTO,
  ImportIssuesRequestDTO,
  ImportReleasesRequestDTO,
} from './dto/importer-callback.dto.js';
import { ImporterCallbacksService } from './importer-callbacks.service.js';
import { ImporterSecretGuard } from './importer-secret.guard.js';

/** Called by `apps/importer` only. Each call renews the attempt's lease, so a working importer never looks silent. */
@Controller('internal/imports/:importId')
@ApiExcludeController()
@Public()
@UseGuards(ImporterSecretGuard)
export class ImporterCallbacksController {
  constructor(private readonly callbacks: ImporterCallbacksService) {}

  @Post('heartbeat')
  @HttpCode(HttpStatus.NO_CONTENT)
  heartbeat(
    @Param('importId') importId: string,
    @Body() { attempt }: ImportAttemptDTO,
  ) {
    return this.callbacks.heartbeat(importId, attempt);
  }

  @Post('releases')
  @HttpCode(HttpStatus.NO_CONTENT)
  releases(
    @Param('importId') importId: string,
    @Body() body: ImportReleasesRequestDTO,
  ) {
    return this.callbacks.releases(importId, body);
  }

  @Post('issues')
  @HttpCode(HttpStatus.NO_CONTENT)
  issues(
    @Param('importId') importId: string,
    @Body() body: ImportIssuesRequestDTO,
  ) {
    return this.callbacks.issues(importId, body);
  }

  @Post('comments')
  @HttpCode(HttpStatus.NO_CONTENT)
  comments(
    @Param('importId') importId: string,
    @Body() body: ImportCommentsRequestDTO,
  ) {
    return this.callbacks.comments(importId, body);
  }

  @Post('finish')
  @HttpCode(HttpStatus.NO_CONTENT)
  async finish(
    @Param('importId') importId: string,
    @Body() body: FinishImportRequestDTO,
  ) {
    await this.callbacks.finish(importId, body);
  }
}
