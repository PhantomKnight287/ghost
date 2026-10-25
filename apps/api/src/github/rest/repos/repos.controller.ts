import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  Param,
  Post,
  Res,
  UseFilters,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { SignInOptional } from '../../../auth/api-key-auth.guard.js';
import type { ArchiveFormat } from '../../../lib/git/archive/archive.js';
import { sendArchive } from '../../../lib/http/send-archive.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubCreateRepositoryDTO } from './dto/create-repository.dto.js';
import { GithubReposService } from './repos.service.js';
import { TransformToLowercasePipe } from '../../../pipes/transform-to-lowercase/transform-to-lowercase.pipe.js';

@Controller('v3')
@ApiTags('GitHub compatibility')
@SignInOptional()
@UseFilters(GithubRestFilter)
export class ReposController {
  private readonly logger = new Logger(ReposController.name);

  constructor(private readonly repos: GithubReposService) {}

  @Get('repos/:owner/:repo')
  @ApiOperation({ summary: 'A repository, in GitHub REST shape' })
  get(
    @Param('owner',TransformToLowercasePipe) owner: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.repos.get({ owner, repo, viewer });
  }

  @Get('repos/:owner/:repo/readme')
  @ApiOperation({
    summary:
      "The repository's README at the default branch, base64 as GitHub returns it",
  })
  readme(
    @Param('owner',TransformToLowercasePipe) owner: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.repos.readme({ owner, repo, viewer });
  }

  // A ref may hold slashes (`feat/x`, `refs/heads/feat/x`), so it is the rest of the path.
  @Get('repos/:owner/:repo/zipball{/*ref}')
  @ApiOperation({ summary: 'A zip of the repository at a ref' })
  zipball(
    @Param('owner',TransformToLowercasePipe) owner: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Param('ref') ref: string[] | undefined,
    @Viewer() viewer: GithubViewer | null,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() response: Response,
  ) {
    return this.archive(
      'zip',
      { owner, repo, ref: ref?.join('/'), viewer, ifNoneMatch },
      response,
    );
  }

  @Get('repos/:owner/:repo/tarball{/*ref}')
  @ApiOperation({ summary: 'A gzipped tarball of the repository at a ref' })
  tarball(
    @Param('owner',TransformToLowercasePipe) owner: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Param('ref') ref: string[] | undefined,
    @Viewer() viewer: GithubViewer | null,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() response: Response,
  ) {
    return this.archive(
      'tar.gz',
      { owner, repo, ref: ref?.join('/'), viewer, ifNoneMatch },
      response,
    );
  }

  private async archive(
    format: ArchiveFormat,
    {
      ifNoneMatch,
      ...target
    }: {
      owner: string;
      repo: string;
      ref: string | undefined;
      viewer: GithubViewer | null;
      ifNoneMatch: string | undefined;
    },
    response: Response,
  ) {
    const archive = await this.repos.archive({ ...target, format });
    await sendArchive(response, archive, {
      format,
      ifNoneMatch,
      logger: this.logger,
    });
  }

  @Post('user/repos')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a repository for the authenticated user' })
  createForUser(
    @Body() body: GithubCreateRepositoryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.repos.create(viewer, body, undefined, 'POST /user/repos');
  }

  @Post('orgs/:org/repos')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a repository in an organization' })
  createForOrganization(
    @Param('org') org: string,
    @Body() body: GithubCreateRepositoryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.repos.create(viewer, body, org, 'POST /orgs/:org/repos');
  }
}
