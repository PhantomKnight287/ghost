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
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { SignInOptional } from '../../../auth/api-key-auth.guard.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubRestInterceptor } from '../github-rest.interceptor.js';
import {
  GithubReleaseAssetDTO,
  GithubUploadReleaseAssetQueryDTO,
} from './dto/release.dto.js';
import { GithubReleasesService } from './releases.service.js';
import { TransformToLowercasePipe } from '../../../pipes/transform-to-lowercase/transform-to-lowercase.pipe.js';
import { RequireAppPermission } from '../../../lib/apps/app-permission.js';

/** The `upload_url` every release carries, under `/api/uploads` as on GitHub Enterprise. No body parser runs here, so a file of any type streams through untouched. */
@RequireAppPermission('contents')
@Controller('uploads/repos/:owner/:repo/releases')
@ApiTags('GitHub compatibility')
@SignInOptional()
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
  @ApiCreatedResponse({ type: GithubReleaseAssetDTO })
  upload(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
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
