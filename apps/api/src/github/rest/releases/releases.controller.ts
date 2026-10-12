import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseFilters,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import type { Request, Response } from 'express';

import {
  GithubValidationError,
  UnprocessableError,
} from '../../../lib/github/github.errors.js';
import { pageOf } from '../../../lib/github/rest.js';
import { ReleaseAssetsService } from '../../../resources/releases/release-assets.service.js';
import { ReleasesService } from '../../../resources/releases/releases.service.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubPageQueryDTO } from '../issues/dto/issue.dto.js';
import { GithubIssuesService } from '../issues/issues.service.js';
import {
  GithubCreateReleaseDTO,
  GithubUpdateReleaseAssetDTO,
  GithubUpdateReleaseDTO,
} from './dto/release.dto.js';
import { GithubReleasesService } from './releases.service.js';

const ID = new ParseIntPipe({ errorHttpStatusCode: 404 });

/** GitHub answers a discussion category that does not exist with 404, and Ghost has no discussions. */
function refuseDiscussion(category: string | undefined) {
  if (category !== undefined) throw new NotFoundException();
}

@Controller('v3/repos/:owner/:repo/releases')
@ApiTags('GitHub compatibility')
@AllowAnonymous()
@UseFilters(GithubRestFilter)
export class GithubReleasesController {
  constructor(
    private readonly github: GithubIssuesService,
    private readonly releasesRest: GithubReleasesService,
    private readonly releases: ReleasesService,
    private readonly assets: ReleaseAssetsService,
  ) {}

  @Get()
  @ApiOperation({ summary: "A repository's releases, newest first" })
  async list(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query() query: GithubPageQueryDTO,
    @Viewer() viewer: GithubViewer | null,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const page = pageOf(query);
    const { releases, total } = await this.releases.pageReleases({
      ...this.github.ref(repository, viewer),
      offset: page.offset,
      limit: page.perPage,
      order: { field: 'created', direction: 'desc' },
    });
    this.github.link(request, response, page, total);
    return this.releasesRest.list(repository, releases);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a release, and its tag when the tag does not exist',
  })
  async create(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Body() body: GithubCreateReleaseDTO,
    @Viewer() viewer: GithubViewer | null,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'POST /repos/:owner/:repo/releases',
    );
    refuseDiscussion(body.discussion_category_name);
    if (body.generate_release_notes)
      throw new GithubValidationError([
        {
          resource: 'Release',
          field: 'generate_release_notes',
          code: 'invalid',
        },
      ]);
    const created = await this.releases.createRelease({
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      body: {
        tagName: body.tag_name,
        target: body.target_commitish,
        name: body.name,
        body: body.body,
        isDraft: body.draft,
        isPrerelease: body.prerelease,
      },
    });
    const release = await this.releasesRest.one(repository, created);
    response.status(HttpStatus.CREATED).setHeader('Location', release.url);
    return release;
  }

  @Get('latest')
  @ApiOperation({
    summary: 'The newest published release that is not a prerelease',
  })
  async latest(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    return this.releasesRest.one(
      repository,
      await this.releases.getLatestRelease(this.github.ref(repository, viewer)),
    );
  }

  /** Published releases only, as on GitHub: gh finds a draft by its tag through GraphQL. */
  @Get('tags/*tag')
  @ApiOperation({ summary: 'A published release by its tag' })
  async byTag(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('tag') tag: string[],
    @Viewer() viewer: GithubViewer | null,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const release = await this.releases.getReleaseByTag({
      ...this.github.ref(repository, viewer),
      tagName: tag.join('/'),
    });
    if (release.isDraft) throw new NotFoundException();
    return this.releasesRest.one(repository, release);
  }

  @Get('assets/:asset_id')
  @ApiOperation({
    summary:
      'A release asset, or its bytes when asked for application/octet-stream',
  })
  async asset(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('asset_id', ID) assetId: number,
    @Headers('accept') accept: string | undefined,
    @Viewer() viewer: GithubViewer | null,
    @Res({ passthrough: true }) response: Response,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const { release, asset } = await this.releasesRest.assetByNumericId(
      repository,
      viewer,
      assetId,
    );
    if (!/application\/octet-stream/i.test(accept ?? ''))
      return this.releasesRest.assetOf(repository, release, asset.id);

    const download = await this.assets.download({
      ...this.github.ref(repository, viewer),
      asset: { id: asset.id },
    });
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
  async updateAsset(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('asset_id', ID) assetId: number,
    @Body() body: GithubUpdateReleaseAssetDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'PATCH /repos/:owner/:repo/releases/assets/:asset_id',
    );
    const { release, asset } = await this.releasesRest.assetByNumericId(
      repository,
      signedIn,
      assetId,
    );
    await this.assets.update({
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      assetId: asset.id,
      name: body.name,
      label: body.label,
    });
    return this.releasesRest.assetOf(
      repository,
      await this.releases.getRelease({
        ...this.github.ref(repository, signedIn),
        id: release.id,
      }),
      asset.id,
    );
  }

  @Delete('assets/:asset_id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a release asset' })
  async deleteAsset(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('asset_id', ID) assetId: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'DELETE /repos/:owner/:repo/releases/assets/:asset_id',
    );
    const { asset } = await this.releasesRest.assetByNumericId(
      repository,
      signedIn,
      assetId,
    );
    await this.assets.delete({
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      assetId: asset.id,
    });
  }

  @Get(':release_id')
  @ApiOperation({
    summary: 'A release by its integer id, drafts included for writers',
  })
  async get(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('release_id', ID) releaseId: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    return this.releasesRest.one(
      repository,
      await this.releasesRest.byNumericId(repository, viewer, releaseId),
    );
  }

  @Patch(':release_id')
  @ApiOperation({ summary: 'Edit a release: name, notes, draft, prerelease' })
  async update(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('release_id', ID) releaseId: number,
    @Body() body: GithubUpdateReleaseDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'PATCH /repos/:owner/:repo/releases/:release_id',
    );
    refuseDiscussion(body.discussion_category_name);
    const current = await this.releasesRest.byNumericId(
      repository,
      signedIn,
      releaseId,
    );
    if (body.tag_name !== undefined && body.tag_name !== current.tagName)
      throw new UnprocessableError(
        'Ghost cannot move a release to another tag',
      );
    const updated = await this.releases.updateRelease({
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      id: current.id,
      body: {
        name: body.name,
        body: body.body,
        isDraft: body.draft,
        isPrerelease: body.prerelease,
      },
    });
    return this.releasesRest.one(repository, updated);
  }

  /** The tag stays, as on GitHub; gh deletes it separately through git/refs. */
  @Delete(':release_id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a release and its assets' })
  async delete(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('release_id', ID) releaseId: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'DELETE /repos/:owner/:repo/releases/:release_id',
    );
    const release = await this.releasesRest.byNumericId(
      repository,
      signedIn,
      releaseId,
    );
    await this.releases.deleteRelease({
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      id: release.id,
    });
  }

  @Get(':release_id/assets')
  @ApiOperation({ summary: "A release's assets, by name" })
  async listAssets(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('release_id', ID) releaseId: number,
    @Query() query: GithubPageQueryDTO,
    @Viewer() viewer: GithubViewer | null,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const page = pageOf(query);
    const { assets } = await this.releasesRest.one(
      repository,
      await this.releasesRest.byNumericId(repository, viewer, releaseId),
    );
    this.github.link(request, response, page, assets.length);
    return assets.slice(page.offset, page.offset + page.perPage);
  }
}
