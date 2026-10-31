import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { SignInOptional } from '../../../auth/api-key-auth.guard.js';
import { RequireAppPermission } from '../../../lib/apps/app-permission.js';
import type { ArchiveFormat } from '../../../lib/git/archive/archive.js';
import { sendArchive } from '../../../lib/http/send-archive.js';
import { TransformToLowercasePipe } from '../../../pipes/transform-to-lowercase/transform-to-lowercase.pipe.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { ApiGithubErrors } from '../dto/error.dto.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubRestInterceptor } from '../github-rest.interceptor.js';
import { GithubCreateRepositoryDTO } from './dto/create-repository.dto.js';
import {
  GithubListOrganizationRepositoriesQueryDTO,
  GithubListUserRepositoriesQueryDTO,
  GithubListViewerRepositoriesQueryDTO,
} from './dto/list-repositories.dto.js';
import { GithubReadmeDTO, GithubRepositoryDTO } from './dto/repository.dto.js';
import { GithubUpdateRepositoryDTO } from './dto/update-repository.dto.js';
import { GithubReposService } from './repos.service.js';

@Controller('v3')
@ApiTags('GitHub compatibility')
@SignInOptional()
@UseFilters(GithubRestFilter)
@ApiGithubErrors()
export class ReposController {
  private readonly logger = new Logger(ReposController.name);

  constructor(private readonly repos: GithubReposService) {}

  @Get('repos/:owner/:repo')
  @RequireAppPermission('metadata')
  @ApiOperation({ summary: 'A repository, in GitHub REST shape' })
  @ApiOkResponse({ type: GithubRepositoryDTO })
  get(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.repos.get({ owner, repo, viewer });
  }

  @Get('repos/:owner/:repo/readme')
  @RequireAppPermission('contents')
  @ApiOperation({
    summary:
      "The repository's README at the default branch, base64 as GitHub returns it",
  })
  @ApiOkResponse({ type: GithubReadmeDTO })
  readme(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.repos.readme({ owner, repo, viewer });
  }

  // A ref may hold slashes (`feat/x`, `refs/heads/feat/x`), so it is the rest of the path.
  @Get('repos/:owner/:repo/zipball{/*ref}')
  @RequireAppPermission('contents')
  @ApiOperation({ summary: 'A zip of the repository at a ref' })
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  zipball(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
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
  @RequireAppPermission('contents')
  @ApiOperation({ summary: 'A gzipped tarball of the repository at a ref' })
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  tarball(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
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
  @ApiCreatedResponse({ type: GithubRepositoryDTO })
  createForUser(
    @Body() body: GithubCreateRepositoryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.repos.create(viewer, body, undefined, 'POST /user/repos');
  }

  @Post('orgs/:org/repos')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a repository in an organization' })
  @ApiCreatedResponse({ type: GithubRepositoryDTO })
  createForOrganization(
    @Param('org') org: string,
    @Body() body: GithubCreateRepositoryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.repos.create(viewer, body, org, 'POST /orgs/:org/repos');
  }

  @Get('user/repos')
  @UseInterceptors(GithubRestInterceptor)
  @ApiOperation({
    summary: "The authenticated user's repositories, private ones included",
    description:
      "Every repository the user holds a role on: their own, the ones shared with them, and their organizations'.",
  })
  @ApiOkResponse({ type: [GithubRepositoryDTO] })
  listForViewer(
    @Query() query: GithubListViewerRepositoriesQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.repos.listForViewer(viewer, query);
  }

  @Get('users/:username/repos')
  @UseInterceptors(GithubRestInterceptor)
  @ApiOperation({ summary: "A user's or organization's public repositories" })
  @ApiOkResponse({ type: [GithubRepositoryDTO] })
  listForUser(
    @Param('username') username: string,
    @Query() query: GithubListUserRepositoriesQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.repos.listForUser(username, viewer, query);
  }

  @Get('orgs/:org/repos')
  @UseInterceptors(GithubRestInterceptor)
  @ApiOperation({
    summary: "An organization's repositories the viewer can read",
  })
  @ApiOkResponse({ type: [GithubRepositoryDTO] })
  listForOrganization(
    @Param('org') org: string,
    @Query() query: GithubListOrganizationRepositoriesQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.repos.listForOrganization(org, viewer, query);
  }

  @Patch('repos/:owner/:repo')
  @ApiOperation({
    summary:
      'Rename, describe, change the visibility or the default branch of a repository',
  })
  @ApiOkResponse({ type: GithubRepositoryDTO })
  update(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Body() body: GithubUpdateRepositoryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.repos.update({ owner, repo, viewer }, body);
  }

  @Delete('repos/:owner/:repo')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a repository; the token needs `delete_repo`',
  })
  @ApiNoContentResponse()
  delete(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.repos.delete({ owner, repo, viewer });
  }
}
