import {
  Controller,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import type { Request } from 'express';

import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubRestInterceptor } from '../github-rest.interceptor.js';
import { GithubUploadReleaseAssetQueryDTO } from './dto/release.dto.js';
import { GithubReleasesService } from './releases.service.js';

/** The `upload_url` every release carries, under `/api/uploads` as on GitHub Enterprise. No body parser runs here, so a file of any type streams through untouched. */
@Controller('uploads/repos/:owner/:repo/releases')
@ApiTags('GitHub compatibility')
@AllowAnonymous()
@UseFilters(GithubRestFilter)
@UseInterceptors(GithubRestInterceptor)
export class GithubUploadsController {
  constructor(private readonly releases: GithubReleasesService) {}

  @Post(':release_id/assets')
  @ApiOperation({
    summary:
      "Upload a release asset: the raw bytes, served afterwards with the request's Content-Type",
  })
  @ApiConsumes('application/octet-stream')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  upload(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('release_id', new ParseIntPipe({ errorHttpStatusCode: 404 }))
    releaseId: number,
    @Query() query: GithubUploadReleaseAssetQueryDTO,
    @Viewer() viewer: GithubViewer | null,
    @Req() request: Request,
  ) {
    return this.releases.upload({ owner, repo, viewer }, releaseId, query, {
      type: request.headers['content-type']?.split(';')[0]?.trim(),
      length: request.headers['content-length'],
      body: request,
    });
  }
}
