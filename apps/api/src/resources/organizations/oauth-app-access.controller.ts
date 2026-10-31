import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Session,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { CookieOnly } from '../../auth/api-key-auth.guard.js';
import { ErrorResponseDTO } from '../../domain/http.js';
import {
  DecideOauthAppAccessDTO,
  ListOauthAppAccessResponseDTO,
  OauthAppAccessDTO,
} from './dto/oauth-app-access.dto.js';
import { OauthAppAccessService } from './oauth-app-access.service.js';

/** An organization's OAuth app access restrictions, turned on in its settings. */
@ApiTags('Organizations')
@CookieOnly()
@Controller('organizations/:slug/oauth-app-access')
export class OauthAppAccessController {
  constructor(private readonly access: OauthAppAccessService) {}

  @Get()
  @ApiOperation({
    summary: 'The OAuth apps members asked for, and the answers. Admins only.',
  })
  @ApiOkResponse({ type: ListOauthAppAccessResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  list(@Param('slug') slug: string, @Session() session: UserSession) {
    return this.access.list(slug, session.user.id);
  }

  @Put(':clientId')
  @ApiOperation({
    summary: 'Approve or deny an OAuth app. Admins only.',
    description: 'Whether or not anyone asked for it.',
  })
  @ApiOkResponse({ type: OauthAppAccessDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  decide(
    @Param('slug') slug: string,
    @Param('clientId') clientId: string,
    @Body() body: DecideOauthAppAccessDTO,
    @Session() session: UserSession,
  ) {
    return this.access.decide(slug, session.user.id, clientId, body.state);
  }

  @Delete(':clientId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke an answer about an OAuth app. Admins only.',
    description:
      'A revoked approval blocks the app again; a revoked denial lets members ask again.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  revoke(
    @Param('slug') slug: string,
    @Param('clientId') clientId: string,
    @Session() session: UserSession,
  ) {
    return this.access.revoke(slug, session.user.id, clientId);
  }

  @Post(':clientId/request')
  @ApiOperation({
    summary: "Ask the organization's admins to approve an OAuth app",
    description: 'Any member may ask. An answer already given stands.',
  })
  @ApiCreatedResponse({ type: OauthAppAccessDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  request(
    @Param('slug') slug: string,
    @Param('clientId') clientId: string,
    @Session() session: UserSession,
  ) {
    return this.access.request(slug, session.user.id, clientId);
  }
}
