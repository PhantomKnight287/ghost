import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseFilters,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubCreateRepositoryDTO } from './dto/create-repository.dto.js';
import { GithubReposService } from './repos.service.js';

@Controller('v3')
@ApiTags('GitHub compatibility')
@AllowAnonymous()
@UseFilters(GithubRestFilter)
export class ReposController {
  constructor(private readonly repos: GithubReposService) {}

  @Get('repos/:owner/:repo')
  @ApiOperation({ summary: 'A repository, in GitHub REST shape' })
  get(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
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
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.repos.readme({ owner, repo, viewer });
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
