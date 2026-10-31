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
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { SignInOptional } from '../../../auth/api-key-auth.guard.js';
import { RequireAppPermission } from '../../../lib/apps/app-permission.js';
import { TransformToLowercasePipe } from '../../../pipes/transform-to-lowercase/transform-to-lowercase.pipe.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { ApiGithubErrors } from '../dto/error.dto.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubRestInterceptor } from '../github-rest.interceptor.js';
import { GithubPageQueryDTO } from '../issues/dto/issue.dto.js';
import {
  GithubCombinedStatusDTO,
  GithubCreateStatusDTO,
  GithubStatusDTO,
} from './dto/status.dto.js';
import { GithubStatusesService } from './statuses.service.js';

@RequireAppPermission('statuses')
@Controller('v3')
@ApiTags('GitHub compatibility')
@SignInOptional()
@UseFilters(GithubRestFilter)
@UseInterceptors(GithubRestInterceptor)
@ApiGithubErrors()
export class GithubStatusesController {
  constructor(private readonly statuses: GithubStatusesService) {}

  @Post('repos/:owner/:repo/statuses/:sha')
  @ApiOperation({
    summary: 'Report a status on a commit, by its full sha',
  })
  @ApiCreatedResponse({ type: GithubStatusDTO })
  create(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('sha') sha: string,
    @Body() body: GithubCreateStatusDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.statuses.create({ owner, repo, viewer }, sha, body);
  }

  // A ref may hold slashes (`feat/x`), so it is everything between `commits/` and the suffix.
  @Get('repos/:owner/:repo/commits/*ref/statuses')
  @ApiOperation({ summary: "Every status on a ref's commit, newest first" })
  @ApiOkResponse({ type: [GithubStatusDTO] })
  list(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
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
  @ApiOkResponse({ type: GithubCombinedStatusDTO })
  combined(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('ref') ref: string[],
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.statuses.combined({ owner, repo, viewer }, ref.join('/'));
  }
}
