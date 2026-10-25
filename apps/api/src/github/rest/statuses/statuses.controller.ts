import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { SignInOptional } from '../../../auth/api-key-auth.guard.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubRestInterceptor } from '../github-rest.interceptor.js';
import { GithubPageQueryDTO } from '../issues/dto/issue.dto.js';
import { GithubCreateStatusDTO } from './dto/status.dto.js';
import { GithubStatusesService } from './statuses.service.js';

@Controller('v3')
@ApiTags('GitHub compatibility')
@SignInOptional()
@UseFilters(GithubRestFilter)
@UseInterceptors(GithubRestInterceptor)
export class GithubStatusesController {
  constructor(private readonly statuses: GithubStatusesService) {}

  @Post('repos/:owner/:repo/statuses/:sha')
  @ApiOperation({
    summary: 'Report a status on a commit, by its full sha',
  })
  create(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('sha') sha: string,
    @Body() body: GithubCreateStatusDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.statuses.create({ owner, repo, viewer }, sha, body);
  }

  // A ref may hold slashes (`feat/x`), so it is everything between `commits/` and the suffix.
  @Get('repos/:owner/:repo/commits/*ref/statuses')
  @ApiOperation({ summary: "Every status on a ref's commit, newest first" })
  list(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('ref') ref: string[],
    @Query() query: GithubPageQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.statuses.list({ owner, repo, viewer }, ref.join('/'), query);
  }

  @Get('repos/:owner/:repo/commits/*ref/status')
  @ApiOperation({
    summary:
      "The combined status of a ref's commit: the newest status of each context",
  })
  combined(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('ref') ref: string[],
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.statuses.combined({ owner, repo, viewer }, ref.join('/'));
  }
}
