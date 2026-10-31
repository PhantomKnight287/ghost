import { Controller, Get, Param, Session } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { CookieOnly } from '../../auth/api-key-auth.guard.js';
import { ErrorResponseDTO } from '../../domain/http.js';
import { ListOauthAppOrganizationAccessResponseDTO } from './dto/oauth-app-access.dto.js';
import { OauthAppAccessService } from './oauth-app-access.service.js';

/** Where an OAuth app reaches among the signed-in account's organizations. */
@ApiTags('OAuth apps')
@CookieOnly()
@Controller('oauth-apps/:clientId/organizations')
export class OauthAppOrganizationsController {
  constructor(private readonly access: OauthAppAccessService) {}

  @Get()
  @ApiOperation({
    summary: "Whether an OAuth app reaches each of the account's organizations",
    description:
      'For the approval screen and the authorized apps page, where a member asks for a restricted app.',
  })
  @ApiOkResponse({ type: ListOauthAppOrganizationAccessResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  list(@Param('clientId') clientId: string, @Session() session: UserSession) {
    return this.access.forApp(session.user.id, clientId);
  }
}
