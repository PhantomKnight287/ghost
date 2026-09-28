import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Session,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { ErrorResponseDTO } from '../../domain/http.js';
import {
  GetNotificationsQueryDTO,
  GetNotificationsResponseDTO,
  UnreadCountResponseDTO,
  UpdateNotificationRequestDTO,
} from './dto/notification.dto.js';
import { NotificationsService } from './notifications.service.js';

@Controller('notifications')
@ApiTags('Notifications')
@ApiUnauthorizedResponse({ type: ErrorResponseDTO })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List notifications',
    description:
      "The signed-in user's inbox, one entry per thread, most recently active first. Pages are cursor-based: pass a response `nextCursor` back as `cursor`.",
  })
  @ApiOkResponse({ type: GetNotificationsResponseDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  list(
    @Query() query: GetNotificationsQueryDTO,
    @Session() session: UserSession,
  ): Promise<GetNotificationsResponseDTO> {
    return this.notifications.list(session.user.id, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Count unread notifications' })
  @ApiOkResponse({ type: UnreadCountResponseDTO })
  unreadCount(
    @Session() session: UserSession,
  ): Promise<UnreadCountResponseDTO> {
    return this.notifications.unreadCount(session.user.id);
  }

  @Post('read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark every notification as read' })
  @ApiNoContentResponse()
  markAllRead(@Session() session: UserSession): Promise<void> {
    return this.notifications.markAllRead(session.user.id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark a notification as read or unread' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  update(
    @Param('id') id: string,
    @Body() body: UpdateNotificationRequestDTO,
    @Session() session: UserSession,
  ): Promise<void> {
    return this.notifications.setUnread(session.user.id, id, body.unread);
  }
}
