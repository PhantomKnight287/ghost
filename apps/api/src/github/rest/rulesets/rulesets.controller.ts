import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  type PipeTransform,
  Post,
  Put,
  Query,
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

import { SignInOptional } from '../../../auth/api-key-auth.guard.js';
import { GithubNotFoundError } from '../../../lib/github/github.errors.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubRestInterceptor } from '../github-rest.interceptor.js';
import {
  GithubBranchRuleDTO,
  GithubCreateRulesetDTO,
  GithubRulesetDTO,
  GithubRulesetSummaryDTO,
  GithubRuleSuiteDetailDTO,
  GithubRuleSuiteDTO,
  GithubRuleSuiteQueryDTO,
  GithubRuleSuitesQueryDTO,
  GithubUpdateRulesetDTO,
} from './dto/rulesets.dto.js';
import { GithubRulesetsService } from './rulesets.service.js';
import { TransformToLowercasePipe } from '../../../pipes/transform-to-lowercase/transform-to-lowercase.pipe.js';
import { ApiGithubErrors } from '../dto/error.dto.js';

// numeric_id is a bigint, read as a JavaScript number: an id past the safe range could only round onto another ruleset or overflow Postgres, so it is as absent as any unknown id.
const ID: PipeTransform<string, number> = {
  transform: (value) => {
    const id = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(id))
      throw new GithubNotFoundError();
    return id;
  },
};

@Controller('v3/repos/:owner/:repo')
@ApiTags('GitHub compatibility')
@SignInOptional()
@UseFilters(GithubRestFilter)
@UseInterceptors(GithubRestInterceptor)
@ApiGithubErrors()
export class GithubRulesetsController {
  constructor(private readonly rulesets: GithubRulesetsService) {}

  @Get('rulesets')
  @ApiOperation({
    summary: "A repository's rulesets, as summaries",
    description:
      '`includes_parents` is ignored until organization rulesets exist.',
  })
  @ApiOkResponse({ type: [GithubRulesetSummaryDTO] })
  list(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.rulesets.list({ owner, repo, viewer });
  }

  @Post('rulesets')
  @ApiOperation({ summary: 'Create a ruleset' })
  @ApiCreatedResponse({ type: GithubRulesetDTO })
  create(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Body() body: GithubCreateRulesetDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.rulesets.create({ owner, repo, viewer }, body);
  }

  // Before `rulesets/:id`, whose numeric id pipe would answer `rule-suites` with 404.
  @Get('rulesets/rule-suites')
  @ApiOperation({
    summary:
      'Rule insights: every write the rulesets checked, one suite per ref',
  })
  @ApiOkResponse({ type: [GithubRuleSuiteDTO] })
  ruleSuites(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Query() query: GithubRuleSuitesQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.rulesets.ruleSuites({ owner, repo, viewer }, query);
  }

  @Get('rulesets/rule-suites/:id')
  @ApiOperation({ summary: 'One rule suite with its rule evaluations' })
  @ApiOkResponse({ type: GithubRuleSuiteDetailDTO })
  ruleSuite(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('id', ID) id: number,
    @Query() query: GithubRuleSuiteQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.rulesets.ruleSuite({ owner, repo, viewer }, id, query);
  }

  @Get('rulesets/:id')
  @ApiOperation({ summary: 'A ruleset' })
  @ApiOkResponse({ type: GithubRulesetDTO })
  get(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('id', ID) id: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.rulesets.get({ owner, repo, viewer }, id);
  }

  @Put('rulesets/:id')
  @ApiOperation({
    summary: 'Update a ruleset; fields left out keep their value',
  })
  @ApiOkResponse({ type: GithubRulesetDTO })
  update(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('id', ID) id: number,
    @Body() body: GithubUpdateRulesetDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.rulesets.update({ owner, repo, viewer }, id, body);
  }

  @Delete('rulesets/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a ruleset' })
  @ApiNoContentResponse()
  remove(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('id', ID) id: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.rulesets.remove({ owner, repo, viewer }, id);
  }

  @Get('rules/branches/*branch')
  @ApiOperation({ summary: 'The active rules that apply to a branch' })
  @ApiOkResponse({ type: [GithubBranchRuleDTO] })
  branchRules(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('branch') branch: string[],
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.rulesets.branchRules({ owner, repo, viewer }, branch.join('/'));
  }
}
