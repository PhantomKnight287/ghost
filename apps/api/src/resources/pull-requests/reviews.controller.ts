import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Session,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { ErrorResponseDTO } from '../../domain/http.js';
import {
  ApplySuggestionResponseDTO,
  CreateReviewRequestDTO,
  DismissReviewRequestDTO,
  GetPendingReviewResponseDTO,
  PullRequestReviewDTO,
  ReviewCommentBodyDTO,
  ReviewCommentRequestDTO,
  ReviewReplyDTO,
  ReviewThreadResolutionDTO,
  UpdateReviewRequestDTO,
} from './dto/pull-request-review.dto.js';
import { ReviewThreadsService } from './review-threads.service.js';
import { ReviewsService } from './reviews.service.js';
import { TransformToLowercasePipe } from '../../pipes/transform-to-lowercase/transform-to-lowercase.pipe.js';

@Controller('repositories/:username/:repo/pulls/:number')
@ApiTags('Pull request reviews')
export class ReviewsController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly threads: ReviewThreadsService,
  ) {}

  @Post('reviews')
  @ApiOperation({
    summary: 'Comment on, approve or request changes to a pull request',
  })
  @ApiCreatedResponse({ type: PullRequestReviewDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiConflictResponse({ type: ErrorResponseDTO })
  submitReview(
    @Param('username', TransformToLowercasePipe) username: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Body() body: CreateReviewRequestDTO,
    @Session() session: UserSession,
  ) {
    return this.reviews.submitReview({
      username,
      repo,
      number,
      requesterId: session.user.id,
      body,
    });
  }

  @Get('reviews/pending')
  @ApiOperation({ summary: 'Your pending review' })
  @ApiOkResponse({ type: GetPendingReviewResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getPendingReview(
    @Param('username', TransformToLowercasePipe) username: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Session() session: UserSession,
  ) {
    return this.reviews.getPendingReview({
      username,
      repo,
      number,
      requesterId: session.user.id,
    });
  }

  @Post('reviews/pending/comments')
  @ApiOperation({ summary: 'Add a line comment to your pending review' })
  @ApiCreatedResponse({ type: GetPendingReviewResponseDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiConflictResponse({ type: ErrorResponseDTO })
  addPendingComment(
    @Param('username', TransformToLowercasePipe) username: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Body() body: ReviewCommentRequestDTO,
    @Session() session: UserSession,
  ) {
    return this.reviews.addPendingComment({
      username,
      repo,
      number,
      requesterId: session.user.id,
      body,
    });
  }

  @Delete('reviews/pending')
  @ApiOperation({ summary: 'Discard your pending review and its comments' })
  @ApiOkResponse({ schema: { type: 'object' } })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  discardPendingReview(
    @Param('username', TransformToLowercasePipe) username: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Session() session: UserSession,
  ) {
    return this.reviews.discardPendingReview({
      username,
      repo,
      number,
      requesterId: session.user.id,
    });
  }

  @Patch('reviews/:reviewId')
  @ApiOperation({ summary: "Edit a review's summary" })
  @ApiOkResponse({ type: PullRequestReviewDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  updateReview(
    @Param('username', TransformToLowercasePipe) username: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Param('reviewId') reviewId: string,
    @Body() body: UpdateReviewRequestDTO,
    @Session() session: UserSession,
  ) {
    return this.reviews.updateReview({
      username,
      repo,
      number,
      reviewId,
      requesterId: session.user.id,
      body: body.body,
    });
  }

  @Post('reviews/:reviewId/dismiss')
  @ApiOperation({ summary: 'Dismiss an approval or a request for changes' })
  @ApiCreatedResponse({ type: PullRequestReviewDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiConflictResponse({ type: ErrorResponseDTO })
  dismissReview(
    @Param('username', TransformToLowercasePipe) username: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Param('reviewId') reviewId: string,
    @Body() body: DismissReviewRequestDTO,
    @Session() session: UserSession,
  ) {
    return this.reviews.dismissReview({
      username,
      repo,
      number,
      reviewId,
      requesterId: session.user.id,
      message: body.message,
    });
  }

  @Post('comments/:commentId/replies')
  @ApiOperation({ summary: 'Reply to a line comment' })
  @ApiCreatedResponse({ type: ReviewReplyDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiConflictResponse({ type: ErrorResponseDTO })
  replyToComment(
    @Param('username', TransformToLowercasePipe) username: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Param('commentId') commentId: string,
    @Body() body: ReviewCommentBodyDTO,
    @Session() session: UserSession,
  ) {
    return this.reviews.replyToComment({
      username,
      repo,
      number,
      commentId,
      requesterId: session.user.id,
      body: body.body,
    });
  }

  @Patch('comments/:commentId')
  @ApiOperation({ summary: 'Edit a line comment or reply' })
  @ApiOkResponse({ type: ReviewReplyDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  updateComment(
    @Param('username', TransformToLowercasePipe) username: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Param('commentId') commentId: string,
    @Body() body: ReviewCommentBodyDTO,
    @Session() session: UserSession,
  ) {
    return this.reviews.updateComment({
      username,
      repo,
      number,
      commentId,
      requesterId: session.user.id,
      body: body.body,
    });
  }

  @Delete('comments/:commentId')
  @ApiOperation({
    summary: 'Delete a line comment and its replies, or one reply',
  })
  @ApiOkResponse({ schema: { type: 'object' } })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  deleteComment(
    @Param('username', TransformToLowercasePipe) username: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Param('commentId') commentId: string,
    @Session() session: UserSession,
  ) {
    return this.reviews.deleteComment({
      username,
      repo,
      number,
      commentId,
      requesterId: session.user.id,
    });
  }

  @Post('comments/:commentId/apply')
  @ApiOperation({
    summary: "Commit a comment's suggested change to the head branch",
  })
  @ApiCreatedResponse({ type: ApplySuggestionResponseDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiConflictResponse({ type: ErrorResponseDTO })
  applySuggestion(
    @Param('username', TransformToLowercasePipe) username: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Param('commentId') commentId: string,
    @Session() session: UserSession,
  ) {
    return this.reviews.applySuggestion({
      username,
      repo,
      number,
      commentId,
      requesterId: session.user.id,
    });
  }

  @Post('comments/:commentId/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve the thread a line comment starts' })
  @ApiOkResponse({ type: ReviewThreadResolutionDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDTO })
  resolveThread(
    @Param('username', TransformToLowercasePipe) username: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Param('commentId') commentId: string,
    @Session() session: UserSession,
  ) {
    return this.threads.resolve({
      username,
      repo,
      number,
      commentId,
      requesterId: session.user.id,
      resolved: true,
    });
  }

  @Post('comments/:commentId/unresolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reopen the thread a line comment starts' })
  @ApiOkResponse({ type: ReviewThreadResolutionDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDTO })
  unresolveThread(
    @Param('username', TransformToLowercasePipe) username: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Param('commentId') commentId: string,
    @Session() session: UserSession,
  ) {
    return this.threads.resolve({
      username,
      repo,
      number,
      commentId,
      requesterId: session.user.id,
      resolved: false,
    });
  }
}
