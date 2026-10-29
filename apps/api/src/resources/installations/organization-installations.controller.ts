import { Controller, Get, Param, Session } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { CookieOnly } from '../../auth/api-key-auth.guard.js';
import { ErrorResponseDTO } from '../../domain/http.js';
import { ListInstallationsResponseDTO } from './dto/installation.dto.js';
import { InstallationsService } from './installations.service.js';

/** For its admins. Each installation is then managed at `/installations/:id`, like a user's. */
@ApiTags('Installations')
@CookieOnly()
@Controller('organizations/:slug/installations')
export class OrganizationInstallationsController {
  constructor(private readonly installations: InstallationsService) {}

  @Get()
  @ApiOperation({ summary: 'List the apps installed on an organization' })
  @ApiOkResponse({ type: ListInstallationsResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  list(@Session() session: UserSession, @Param('slug') slug: string) {
    return this.installations.listForOrganization(slug, session.user.id);
  }
}
