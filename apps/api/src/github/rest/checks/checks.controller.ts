import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
import { GithubChecksService } from './checks.service.js';
import {
  GithubCheckAnnotationDTO,
  GithubCheckRunDTO,
  GithubCheckRunsDTO,
  GithubCheckRunsQueryDTO,
  GithubCheckSuiteDTO,
  GithubCheckSuitesDTO,
  GithubCheckSuitesQueryDTO,
  GithubCreateCheckRunDTO,
  GithubCreateCheckSuiteDTO,
  GithubUpdateCheckRunDTO,
} from './dto/check.dto.js';

@RequireAppPermission('checks')
@Controller('v3')
@ApiTags('GitHub compatibility')
@SignInOptional()
@UseFilters(GithubRestFilter)
@UseInterceptors(GithubRestInterceptor)
@ApiGithubErrors()
export class GithubChecksController {
  constructor(private readonly checks: GithubChecksService) {}

  @Post('repos/:owner/:repo/check-runs')
  @ApiOperation({ summary: 'Create a check run; installation tokens only' })
  @ApiCreatedResponse({ type: GithubCheckRunDTO })
  createRun(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Body() body: GithubCreateCheckRunDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.checks.createRun({ owner, repo, viewer }, body);
  }

  @Get('repos/:owner/:repo/check-runs/:id')
  @ApiOperation({ summary: 'A check run' })
  @ApiOkResponse({ type: GithubCheckRunDTO })
  getRun(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('id') id: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.checks.getRun({ owner, repo, viewer }, id);
  }

  @Patch('repos/:owner/:repo/check-runs/:id')
  @ApiOperation({
    summary: "Update a check run; only its app's installation token may",
  })
  @ApiOkResponse({ type: GithubCheckRunDTO })
  updateRun(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('id') id: string,
    @Body() body: GithubUpdateCheckRunDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.checks.updateRun({ owner, repo, viewer }, id, body);
  }

  @Get('repos/:owner/:repo/check-runs/:id/annotations')
  @ApiOperation({ summary: "A check run's annotations, in the order sent" })
  @ApiOkResponse({ type: [GithubCheckAnnotationDTO] })
  annotations(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('id') id: string,
    @Query() query: GithubPageQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.checks.annotations({ owner, repo, viewer }, id, query);
  }

  @Post('repos/:owner/:repo/check-runs/:id/rerequest')
  @ApiOperation({ summary: "Ask the check run's app to run it again" })
  @ApiCreatedResponse({
    type: Object,
    description: 'An empty object, as GitHub answers.',
  })
  rerequestRun(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('id') id: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.checks.rerequestRun({ owner, repo, viewer }, id);
  }

  // A ref may hold slashes (`feat/x`), so it is everything between `commits/` and the suffix.
  @Get('repos/:owner/:repo/commits/*ref/check-runs')
  @ApiOperation({ summary: "The check runs on a ref's commit" })
  @ApiOkResponse({ type: GithubCheckRunsDTO })
  runsForRef(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('ref') ref: string[],
    @Query() query: GithubCheckRunsQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.checks.runsForRef(
      { owner, repo, viewer },
      ref.join('/'),
      query,
    );
  }

  @Get('repos/:owner/:repo/commits/*ref/check-suites')
  @ApiOperation({ summary: "The check suites on a ref's commit" })
  @ApiOkResponse({ type: GithubCheckSuitesDTO })
  suitesForRef(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('ref') ref: string[],
    @Query() query: GithubCheckSuitesQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.checks.suitesForRef(
      { owner, repo, viewer },
      ref.join('/'),
      query,
    );
  }

  @Post('repos/:owner/:repo/check-suites')
  @ApiOperation({
    summary:
      "The caller's app's check suite on a commit, created if it has none",
  })
  @ApiCreatedResponse({ type: GithubCheckSuiteDTO })
  createSuite(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Body() body: GithubCreateCheckSuiteDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.checks.createSuite({ owner, repo, viewer }, body.head_sha);
  }

  @Get('repos/:owner/:repo/check-suites/:id')
  @ApiOperation({ summary: 'A check suite' })
  @ApiOkResponse({ type: GithubCheckSuiteDTO })
  getSuite(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('id') id: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.checks.getSuite({ owner, repo, viewer }, id);
  }

  @Get('repos/:owner/:repo/check-suites/:id/check-runs')
  @ApiOperation({ summary: "A check suite's runs" })
  @ApiOkResponse({ type: GithubCheckRunsDTO })
  runsOfSuite(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('id') id: string,
    @Query() query: GithubCheckRunsQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.checks.runsOfSuite({ owner, repo, viewer }, id, query);
  }

  @Post('repos/:owner/:repo/check-suites/:id/rerequest')
  @ApiOperation({ summary: "Ask the check suite's app to run all of it again" })
  @ApiCreatedResponse({
    type: Object,
    description: 'An empty object, as GitHub answers.',
  })
  rerequestSuite(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('id') id: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.checks.rerequestSuite({ owner, repo, viewer }, id);
  }
}
