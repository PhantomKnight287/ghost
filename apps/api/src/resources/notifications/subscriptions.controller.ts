import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Put,
  Session,
} from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { ErrorResponseDTO } from '../../domain/http.js';
import {
  IssueSubscriptionDTO,
  RepositoryWatchDTO,
} from './dto/notification.dto.js';
import { NotificationsService } from './notifications.service.js';

@Controller('repositories/:username/:repo')
@ApiTags('Notifications')
export class SubscriptionsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('subscription')
  @ApiOperation({ summary: 'Read how the viewer watches a repository' })
  @ApiOkResponse({ type: RepositoryWatchDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getWatch(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Session() session: UserSession,
  ): Promise<RepositoryWatchDTO> {
    return this.notifications.getWatch({
      username,
      repo,
      requesterId: session.user.id,
    });
  }

  @Put('subscription')
  @ApiOperation({ summary: 'Watch, stop watching or ignore a repository' })
  @ApiOkResponse({ type: RepositoryWatchDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  setWatch(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Body() body: RepositoryWatchDTO,
    @Session() session: UserSession,
  ): Promise<RepositoryWatchDTO> {
    return this.notifications.setWatch({
      username,
      repo,
      requesterId: session.user.id,
      level: body.level,
    });
  }

  @Get('issues/:number/subscription')
  @ApiOperation({
    summary:
      'Read whether the viewer is subscribed to an issue or pull request',
  })
  @ApiOkResponse({ type: IssueSubscriptionDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getSubscription(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Session() session: UserSession,
  ): Promise<IssueSubscriptionDTO> {
    return this.notifications.getSubscription({
      username,
      repo,
      number,
      requesterId: session.user.id,
    });
  }

  @Put('issues/:number/subscription')
  @ApiOperation({
    summary: 'Subscribe to or unsubscribe from an issue or pull request',
    description:
      'Unsubscribing outlasts the automatic subscription that commenting adds. Mentions and assignments still notify.',
  })
  @ApiOkResponse({ type: IssueSubscriptionDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  setSubscription(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Body() body: IssueSubscriptionDTO,
    @Session() session: UserSession,
  ): Promise<IssueSubscriptionDTO> {
    return this.notifications.setSubscription({
      username,
      repo,
      number,
      requesterId: session.user.id,
      subscribed: body.subscribed,
    });
  }
}
