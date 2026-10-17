import {
  Controller,
  Post,
  Query,
  Req,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import type { Request } from 'express';

import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubRestInterceptor } from '../github-rest.interceptor.js';
import {
  GithubUploadUserAttachmentQueryDTO,
  GithubUserAttachmentDTO,
} from './dto/user-attachment.dto.js';
import { GithubUserAttachmentsService } from './user-attachments.service.js';

/** The route `gh --attach` uploads to on github.com, under Ghost's `/api/uploads` as release assets are. No body parser runs here, so the file streams through untouched. */
@Controller('uploads/user-attachments')
@ApiTags('GitHub compatibility')
@AllowAnonymous()
@UseFilters(GithubRestFilter)
@UseInterceptors(GithubRestInterceptor)
export class GithubUserAttachmentsController {
  constructor(private readonly attachments: GithubUserAttachmentsService) {}

  @Post('assets')
  @ApiOperation({
    summary:
      'Attach a file to embed in an issue, pull request, comment or release, as `gh --attach` does on github.com',
  })
  @ApiConsumes('application/octet-stream')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiCreatedResponse({ type: GithubUserAttachmentDTO })
  upload(
    @Query() query: GithubUploadUserAttachmentQueryDTO,
    @Viewer() viewer: GithubViewer | null,
    @Req() request: Request,
  ) {
    return this.attachments.upload(viewer, query, {
      type: request.headers['content-type'],
      length: request.headers['content-length'],
      body: request,
    });
  }
}
