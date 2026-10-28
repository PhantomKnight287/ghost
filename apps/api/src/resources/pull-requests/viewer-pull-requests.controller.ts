import { Controller, Get, Query, Session } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import {
  GetPullRequestsResponseDTO,
  GetReviewRequestsQueryDTO,
} from './dto/pull-request.dto.js';
import { PullRequestsService } from './pull-requests.service.js';

@Controller('user')
@ApiTags('Pull requests')
export class ViewerPullRequestsController {
  constructor(private readonly pullRequests: PullRequestsService) {}

  @Get('review-requests')
  @ApiOperation({
    summary: 'Open pull requests asking the signed-in user for a review',
    description:
      'Requests to the user directly or to one of their teams, in every repository the user can read.',
  })
  @ApiOkResponse({ type: GetPullRequestsResponseDTO })
  getReviewRequests(
    @Query() query: GetReviewRequestsQueryDTO,
    @Session() session: UserSession,
  ) {
    return this.pullRequests.getReviewRequests({
      requesterId: session.user.id,
      query,
    });
  }
}
