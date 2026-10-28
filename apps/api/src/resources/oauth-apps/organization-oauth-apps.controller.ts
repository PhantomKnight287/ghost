import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Session,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { CookieOnly } from '../../auth/api-key-auth.guard.js';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';

import { ErrorResponseDTO } from '../../domain/http.js';
import {
  CreatedOauthAppDTO,
  CreateOauthAppDTO,
  ListOauthAppsResponseDTO,
} from './dto/oauth-app.dto.js';
import { OauthAppsService } from './oauth-apps.service.js';

/** An organization's OAuth apps, for its admins. Once an app exists it is managed at `/oauth-apps/:clientId`, like a user's. */
@ApiTags('OAuth apps')
@CookieOnly()
@Controller('organizations/:slug/oauth-apps')
export class OrganizationOauthAppsController {
  constructor(private readonly apps: OauthAppsService) {}

  @Get()
  @ApiOperation({ summary: "List an organization's OAuth apps" })
  @ApiOkResponse({ type: ListOauthAppsResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  list(@Session() session: UserSession, @Param('slug') slug: string) {
    return this.apps.listForOrganization(slug, session.user.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Register an OAuth app for an organization',
    description:
      'The response carries the client secret. It is never shown again; rotate it to get a new one.',
  })
  @ApiCreatedResponse({ type: CreatedOauthAppDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  create(
    @Session() session: UserSession,
    @Param('slug') slug: string,
    @Body() body: CreateOauthAppDTO,
    @Req() request: Request,
  ) {
    return this.apps.create(
      fromNodeHeaders(request.headers),
      session.user.id,
      body,
      slug,
    );
  }
}
