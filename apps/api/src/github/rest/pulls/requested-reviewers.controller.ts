import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { SignInOptional } from '../../../auth/api-key-auth.guard.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubRestInterceptor } from '../github-rest.interceptor.js';
import { GithubRequestedReviewersDTO } from './dto/pull.dto.js';
import { GithubPullsService } from './pulls.service.js';

const NUMBER = new ParseIntPipe({ errorHttpStatusCode: 404 });

@Controller('v3/repos/:owner/:repo/pulls/:number/requested_reviewers')
@ApiTags('GitHub compatibility')
@SignInOptional()
@UseFilters(GithubRestFilter)
@UseInterceptors(GithubRestInterceptor)
export class RequestedReviewersController {
  constructor(private readonly pulls: GithubPullsService) {}

  @Get()
  @ApiOperation({ summary: 'Users and teams asked to review a pull request' })
  list(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', NUMBER) number: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.pulls.listRequestedReviewers({ owner, repo, viewer }, number);
  }

  @Post()
  @ApiOperation({ summary: 'Request reviews from users and teams' })
  request(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', NUMBER) number: number,
    @Body() body: GithubRequestedReviewersDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.pulls.requestReviewers({ owner, repo, viewer }, number, body);
  }

  @Delete()
  @ApiOperation({ summary: 'Remove requested reviewers' })
  remove(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', NUMBER) number: number,
    @Body() body: GithubRequestedReviewersDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.pulls.removeReviewers({ owner, repo, viewer }, number, body);
  }
}
