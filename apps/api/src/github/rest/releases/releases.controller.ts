import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { SignInOptional } from '../../../auth/api-key-auth.guard.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubRestInterceptor } from '../github-rest.interceptor.js';
import { GithubPageQueryDTO } from '../issues/dto/issue.dto.js';
import {
  GithubCreateReleaseDTO,
  GithubReleaseAssetDTO,
  GithubReleaseDTO,
  GithubUpdateReleaseAssetDTO,
  GithubUpdateReleaseDTO,
} from './dto/release.dto.js';
import { GithubReleasesService } from './releases.service.js';
import { TransformToLowercasePipe } from '../../../pipes/transform-to-lowercase/transform-to-lowercase.pipe.js';
import { ApiGithubErrors } from '../dto/error.dto.js';

const ID = new ParseIntPipe({ errorHttpStatusCode: 404 });

@Controller('v3/repos/:owner/:repo/releases')
@ApiTags('GitHub compatibility')
@SignInOptional()
@UseFilters(GithubRestFilter)
@UseInterceptors(GithubRestInterceptor)
@ApiGithubErrors()
export class GithubReleasesController {
  constructor(private readonly releases: GithubReleasesService) {}

  @Get()
  @ApiOperation({ summary: "A repository's releases, newest first" })
  @ApiOkResponse({ type: [GithubReleaseDTO] })
  list(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Query() query: GithubPageQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.releases.list({ owner, repo, viewer }, query);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a release, and its tag when the tag does not exist',
  })
  @ApiCreatedResponse({ type: GithubReleaseDTO })
  create(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Body() body: GithubCreateReleaseDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.releases.create({ owner, repo, viewer }, body);
  }

  @Get('latest')
  @ApiOperation({
    summary: 'The newest published release that is not a prerelease',
  })
  @ApiOkResponse({ type: GithubReleaseDTO })
  latest(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.releases.latest({ owner, repo, viewer });
  }

  @Get('tags/*tag')
  @ApiOperation({ summary: 'A published release by its tag' })
  @ApiOkResponse({ type: GithubReleaseDTO })
  byTag(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('tag') tag: string[],
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.releases.byTag({ owner, repo, viewer }, tag.join('/'));
  }

  @Get('assets/:asset_id')
  @ApiOperation({
    summary:
      'A release asset, or its bytes when asked for application/octet-stream',
  })
  @ApiExtraModels(GithubReleaseAssetDTO)
  @ApiOkResponse({
    content: {
      'application/json': {
        schema: { $ref: getSchemaPath(GithubReleaseAssetDTO) },
      },
      'application/octet-stream': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  async asset(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('asset_id', ID) assetId: number,
    @Headers('accept') accept: string | undefined,
    @Viewer() viewer: GithubViewer | null,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!/application\/octet-stream/i.test(accept ?? ''))
      return this.releases.asset({ owner, repo, viewer }, assetId);
    const download = await this.releases.download(
      { owner, repo, viewer },
      assetId,
    );
    // GitHub may redirect or stream; clients handle both, and streaming keeps the bytes behind this API's own checks.
    response.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(download.size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(download.name)}`,
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(download.stream);
  }

  @Patch('assets/:asset_id')
  @ApiOperation({ summary: 'Rename a release asset or set its label' })
  @ApiOkResponse({ type: GithubReleaseAssetDTO })
  updateAsset(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('asset_id', ID) assetId: number,
    @Body() body: GithubUpdateReleaseAssetDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.releases.updateAsset({ owner, repo, viewer }, assetId, body);
  }

  @Delete('assets/:asset_id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a release asset' })
  @ApiNoContentResponse()
  deleteAsset(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('asset_id', ID) assetId: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.releases.deleteAsset({ owner, repo, viewer }, assetId);
  }

  @Get(':release_id')
  @ApiOperation({
    summary: 'A release by its integer id, drafts included for writers',
  })
  @ApiOkResponse({ type: GithubReleaseDTO })
  get(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('release_id', ID) releaseId: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.releases.get({ owner, repo, viewer }, releaseId);
  }

  @Patch(':release_id')
  @ApiOperation({ summary: 'Edit a release: name, notes, draft, prerelease' })
  @ApiOkResponse({ type: GithubReleaseDTO })
  update(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('release_id', ID) releaseId: number,
    @Body() body: GithubUpdateReleaseDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.releases.update({ owner, repo, viewer }, releaseId, body);
  }

  @Delete(':release_id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a release and its assets' })
  @ApiNoContentResponse()
  delete(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('release_id', ID) releaseId: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.releases.delete({ owner, repo, viewer }, releaseId);
  }

  @Get(':release_id/assets')
  @ApiOperation({ summary: "A release's assets, by name" })
  @ApiOkResponse({ type: [GithubReleaseAssetDTO] })
  listAssets(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('release_id', ID) releaseId: number,
    @Query() query: GithubPageQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.releases.listAssets({ owner, repo, viewer }, releaseId, query);
  }
}
