import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubRestInterceptor } from '../github-rest.interceptor.js';
import {
  GithubCreateRulesetDTO,
  GithubUpdateRulesetDTO,
} from './dto/rulesets.dto.js';
import { GithubRulesetsService } from './rulesets.service.js';

const ID = new ParseIntPipe({ errorHttpStatusCode: 404 });

@Controller('v3/repos/:owner/:repo')
@ApiTags('GitHub compatibility')
@AllowAnonymous()
@UseFilters(GithubRestFilter)
@UseInterceptors(GithubRestInterceptor)
export class GithubRulesetsController {
  constructor(private readonly rulesets: GithubRulesetsService) {}

  @Get('rulesets')
  @ApiOperation({
    summary: "A repository's rulesets, as summaries",
    description:
      '`includes_parents` is ignored until organization rulesets exist.',
  })
  list(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.rulesets.list({ owner, repo, viewer });
  }

  @Post('rulesets')
  @ApiOperation({ summary: 'Create a ruleset' })
  create(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Body() body: GithubCreateRulesetDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.rulesets.create({ owner, repo, viewer }, body);
  }

  @Get('rulesets/:id')
  @ApiOperation({ summary: 'A ruleset' })
  get(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('id', ID) id: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.rulesets.get({ owner, repo, viewer }, id);
  }

  @Put('rulesets/:id')
  @ApiOperation({
    summary: 'Update a ruleset; fields left out keep their value',
  })
  update(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('id', ID) id: number,
    @Body() body: GithubUpdateRulesetDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.rulesets.update({ owner, repo, viewer }, id, body);
  }

  @Delete('rulesets/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a ruleset' })
  remove(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('id', ID) id: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.rulesets.remove({ owner, repo, viewer }, id);
  }

  @Get('rules/branches/*branch')
  @ApiOperation({ summary: 'The active rules that apply to a branch' })
  branchRules(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('branch') branch: string[],
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.rulesets.branchRules({ owner, repo, viewer }, branch.join('/'));
  }
}
