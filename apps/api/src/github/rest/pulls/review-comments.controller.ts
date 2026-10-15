import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
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
import {
  GithubCommentDTO,
  GithubListCommentsQueryDTO,
} from '../issues/dto/issue.dto.js';
import { GithubCreateReviewCommentDTO } from './dto/review-comment.dto.js';
import { GithubReviewCommentsService } from './review-comments.service.js';

const ID = new ParseIntPipe({ errorHttpStatusCode: 404 });

/** Registered before PullsController, so `pulls/comments` is not read as pull request number "comments". */
@Controller('v3/repos/:owner/:repo/pulls')
@ApiTags('GitHub compatibility')
@AllowAnonymous()
@UseFilters(GithubRestFilter)
@UseInterceptors(GithubRestInterceptor)
export class ReviewCommentsController {
  constructor(private readonly comments: GithubReviewCommentsService) {}

  @Get('comments')
  @ApiOperation({
    summary: "Every review comment in a repository's pull requests",
  })
  listForRepository(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query() query: GithubListCommentsQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.comments.listForRepository({ owner, repo, viewer }, query);
  }

  @Get('comments/:comment_id')
  @ApiOperation({ summary: 'A review comment by id' })
  get(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('comment_id', ID) id: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.comments.get({ owner, repo, viewer }, id);
  }

  @Patch('comments/:comment_id')
  @ApiOperation({ summary: 'Edit a review comment; only its author may' })
  update(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('comment_id', ID) id: number,
    @Body() body: GithubCommentDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.comments.update({ owner, repo, viewer }, id, body);
  }

  @Delete('comments/:comment_id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a review comment and its replies' })
  delete(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('comment_id', ID) id: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.comments.delete({ owner, repo, viewer }, id);
  }

  @Get(':number/comments')
  @ApiOperation({ summary: "A pull request's review comments" })
  list(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', ID) number: number,
    @Query() query: GithubListCommentsQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.comments.list({ owner, repo, viewer }, number, query);
  }

  @Post(':number/comments')
  @ApiOperation({ summary: 'Comment on a line of a pull request, or reply' })
  create(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', ID) number: number,
    @Body() body: GithubCreateReviewCommentDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.comments.create({ owner, repo, viewer }, number, body);
  }

  @Get(':number/reviews/:review_id/comments')
  @ApiOperation({ summary: "A review's line comments" })
  listForReview(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', ID) number: number,
    @Param('review_id', ID) reviewId: number,
    @Query() query: GithubListCommentsQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.comments.listForReview(
      { owner, repo, viewer },
      number,
      reviewId,
      query,
    );
  }
}
