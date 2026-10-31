import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Session,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { SignInOptional } from '../../auth/api-key-auth.guard.js';
import { ErrorResponseDTO } from '../../domain/http.js';
import { TransformToLowercasePipe } from '../../pipes/transform-to-lowercase/transform-to-lowercase.pipe.js';
import { SuggestionQueryDTO } from '../issues/dto/suggestion.dto.js';
import {
  RequestableReviewersDTO,
  RequestedReviewersDTO,
  ReviewRequestsBodyDTO,
} from './dto/review-requests.dto.js';
import { ReviewRequestsService } from './review-requests.service.js';

@Controller('repositories/:username/:repo/pulls')
@ApiTags('Pull request reviews')
export class ReviewRequestsController {
  constructor(private readonly reviewRequests: ReviewRequestsService) {}

  @Get(':number/requested-reviewers')
  @SignInOptional()
  @ApiOperation({ summary: 'Users and teams asked to review a pull request' })
  @ApiOkResponse({ type: RequestedReviewersDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  listRequestedReviewers(
    @Param('username', TransformToLowercasePipe) username: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Session() session: UserSession,
  ) {
    return this.reviewRequests.list({
      username,
      repo,
      number,
      requesterId: session?.user?.id,
    });
  }

  @Get(':number/requestable-reviewers')
  @ApiOperation({
    summary: 'Users and teams a review can be requested from',
    description:
      'Up to twenty users with a role of their own on the repository, other than the author, whose username starts with `q`, and the teams the repository is shared with whose slug contains it; `q` written `org/team` matches teams by the part after the slash. Needs the triage role, as requesting does.',
  })
  @ApiOkResponse({ type: RequestableReviewersDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  listRequestableReviewers(
    @Param('username', TransformToLowercasePipe) username: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Query() query: SuggestionQueryDTO,
    @Session() session: UserSession,
  ) {
    return this.reviewRequests.requestable({
      username,
      repo,
      number,
      requesterId: session.user.id,
      q: query.q,
    });
  }

  @Post(':number/requested-reviewers')
  @ApiOperation({ summary: 'Request reviews from users and teams' })
  @ApiCreatedResponse({ type: RequestedReviewersDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDTO })
  requestReviewers(
    @Param('username', TransformToLowercasePipe) username: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Body() body: ReviewRequestsBodyDTO,
    @Session() session: UserSession,
  ) {
    return this.reviewRequests.request({
      username,
      repo,
      number,
      requesterId: session.user.id,
      users: body.users ?? [],
      teams: body.teams ?? [],
    });
  }

  @Delete(':number/requested-reviewers')
  @ApiOperation({ summary: 'Remove requests for review' })
  @ApiOkResponse({ type: RequestedReviewersDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDTO })
  removeRequestedReviewers(
    @Param('username', TransformToLowercasePipe) username: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Body() body: ReviewRequestsBodyDTO,
    @Session() session: UserSession,
  ) {
    return this.reviewRequests.remove({
      username,
      repo,
      number,
      requesterId: session.user.id,
      users: body.users ?? [],
      teams: body.teams ?? [],
    });
  }
}
