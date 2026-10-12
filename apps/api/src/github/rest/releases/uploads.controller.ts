import {
  Controller,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import type { Request, Response } from 'express';

import { GithubValidationError } from '../../../lib/github/github.errors.js';
import { MEDIA_TYPE } from '../../../lib/releases/release-assets.js';
import { ReleaseAssetsService } from '../../../resources/releases/release-assets.service.js';
import { ReleasesService } from '../../../resources/releases/releases.service.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubIssuesService } from '../issues/issues.service.js';
import { GithubUploadReleaseAssetQueryDTO } from './dto/release.dto.js';
import { GithubReleasesService } from './releases.service.js';

/** The `upload_url` every release carries, under `/api/uploads` as on GitHub Enterprise. No body parser runs here, so a file of any type streams through untouched. */
@Controller('uploads/repos/:owner/:repo/releases')
@ApiTags('GitHub compatibility')
@AllowAnonymous()
@UseFilters(GithubRestFilter)
export class GithubUploadsController {
  constructor(
    private readonly github: GithubIssuesService,
    private readonly releasesRest: GithubReleasesService,
    private readonly releases: ReleasesService,
    private readonly assets: ReleaseAssetsService,
  ) {}

  @Post(':release_id/assets')
  @ApiOperation({
    summary:
      "Upload a release asset: the raw bytes, served afterwards with the request's Content-Type",
  })
  @ApiConsumes('application/octet-stream')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  async upload(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('release_id', new ParseIntPipe({ errorHttpStatusCode: 404 }))
    releaseId: number,
    @Query() query: GithubUploadReleaseAssetQueryDTO,
    @Viewer() viewer: GithubViewer | null,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'POST /repos/:owner/:repo/releases/:release_id/assets',
    );
    const release = await this.releasesRest.byNumericId(
      repository,
      signedIn,
      releaseId,
    );
    const type = request.headers['content-type']?.split(';')[0]?.trim();
    if (!type || !MEDIA_TYPE.test(type))
      throw new GithubValidationError([
        { resource: 'ReleaseAsset', field: 'content_type', code: 'invalid' },
      ]);
    const uploaded = await this.assets.upload({
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      releaseId: release.id,
      name: query.name,
      label: query.label,
      type,
      contentLength: request.headers['content-length'],
      body: request,
    });
    response.status(HttpStatus.CREATED);
    return this.releasesRest.assetOf(
      repository,
      await this.releases.getRelease({
        ...this.github.ref(repository, signedIn),
        id: release.id,
      }),
      uploaded.id,
    );
  }
}
