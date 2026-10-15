import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubRestInterceptor } from '../github-rest.interceptor.js';
import { GithubPageQueryDTO } from '../issues/dto/issue.dto.js';
import {
  GithubCreateReviewDTO,
  GithubSubmitReviewDTO,
} from './dto/review-comment.dto.js';
import { GithubReviewsService } from './reviews.service.js';

const ID = new ParseIntPipe({ errorHttpStatusCode: 404 });

@Controller('v3/repos/:owner/:repo/pulls/:number/reviews')
@ApiTags('GitHub compatibility')
@AllowAnonymous()
@UseFilters(GithubRestFilter)
@UseInterceptors(GithubRestInterceptor)
export class GithubReviewsController {
  constructor(private readonly reviews: GithubReviewsService) {}

  @Get()
  @ApiOperation({
    summary: "A pull request's reviews, oldest first, then your pending one",
  })
  list(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', ID) number: number,
    @Query() query: GithubPageQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.reviews.list({ owner, repo, viewer }, number, query);
  }

  @Get(':review_id')
  @ApiOperation({ summary: 'One review of a pull request, by its integer id' })
  get(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', ID) number: number,
    @Param('review_id', ID) reviewId: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.reviews.get({ owner, repo, viewer }, number, reviewId);
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Submit a review with its line comments, or start a pending one',
  })
  create(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', ID) number: number,
    @Body() body: GithubCreateReviewDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.reviews.create({ owner, repo, viewer }, number, body);
  }

  @Post(':review_id/events')
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit your pending review' })
  submit(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', ID) number: number,
    @Param('review_id', ID) reviewId: number,
    @Body() body: GithubSubmitReviewDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.reviews.submitPending(
      { owner, repo, viewer },
      number,
      reviewId,
      body,
    );
  }

  @Delete(':review_id')
  @ApiOperation({ summary: 'Discard your pending review and its comments' })
  delete(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', ID) number: number,
    @Param('review_id', ID) reviewId: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.reviews.deletePending(
      { owner, repo, viewer },
      number,
      reviewId,
    );
  }
}
