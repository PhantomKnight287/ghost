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
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { SignInOptional } from '../../../auth/api-key-auth.guard.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubRestInterceptor } from '../github-rest.interceptor.js';
import {
  GithubPullDTO,
  GithubRequestedReviewersDTO,
  GithubRequestedReviewersResponseDTO,
} from './dto/pull.dto.js';
import { GithubPullsService } from './pulls.service.js';
import { TransformToLowercasePipe } from '../../../pipes/transform-to-lowercase/transform-to-lowercase.pipe.js';
import { ApiGithubErrors } from '../dto/error.dto.js';

const NUMBER = new ParseIntPipe({ errorHttpStatusCode: 404 });

@Controller('v3/repos/:owner/:repo/pulls/:number/requested_reviewers')
@ApiTags('GitHub compatibility')
@SignInOptional()
@UseFilters(GithubRestFilter)
@UseInterceptors(GithubRestInterceptor)
@ApiGithubErrors()
export class RequestedReviewersController {
  constructor(private readonly pulls: GithubPullsService) {}

  @Get()
  @ApiOperation({ summary: 'Users and teams asked to review a pull request' })
  @ApiOkResponse({ type: GithubRequestedReviewersResponseDTO })
  list(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', NUMBER) number: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.pulls.listRequestedReviewers({ owner, repo, viewer }, number);
  }

  @Post()
  @ApiOperation({ summary: 'Request reviews from users and teams' })
  @ApiCreatedResponse({ type: GithubPullDTO })
  request(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', NUMBER) number: number,
    @Body() body: GithubRequestedReviewersDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.pulls.requestReviewers({ owner, repo, viewer }, number, body);
  }

  @Delete()
  @ApiOperation({ summary: 'Remove requested reviewers' })
  @ApiOkResponse({ type: GithubPullDTO })
  remove(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', NUMBER) number: number,
    @Body() body: GithubRequestedReviewersDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.pulls.removeReviewers({ owner, repo, viewer }, number, body);
  }
}
