import { Body, Controller, Get, Param, Post, Session } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { CookieOnly } from '../../auth/api-key-auth.guard.js';
import { ErrorResponseDTO } from '../../domain/http.js';
import { AppsService } from './apps.service.js';
import { AppDTO, CreateAppDTO, ListAppsResponseDTO } from './dto/app.dto.js';

/** An organization's apps, for its admins. Once an app exists it is managed at `/apps/:slug`, like a user's. */
@ApiTags('Apps')
@CookieOnly()
@Controller('organizations/:slug/apps')
export class OrganizationAppsController {
  constructor(private readonly apps: AppsService) {}

  @Get()
  @ApiOperation({ summary: "List an organization's apps" })
  @ApiOkResponse({ type: ListAppsResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  list(@Session() session: UserSession, @Param('slug') slug: string) {
    return this.apps.listForOrganization(slug, session.user.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Register an app for an organization',
    description:
      'Creates its bot user, `slug[bot]`. The slug is made from the name now and never changes.',
  })
  @ApiCreatedResponse({ type: AppDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDTO })
  create(
    @Session() session: UserSession,
    @Param('slug') slug: string,
    @Body() body: CreateAppDTO,
  ) {
    return this.apps.create(session.user.id, body, slug);
  }
}
