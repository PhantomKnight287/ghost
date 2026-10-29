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
import { ListRepositoryAppsResponseDTO } from './dto/installation.dto.js';
import { InstallationsService } from './installations.service.js';

@ApiTags('Installations')
@CookieOnly()
@Controller('repositories/:username/:repo/apps')
export class RepositoryAppsController {
  constructor(private readonly installations: InstallationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List the apps installed on a repository',
    description:
      'Admins only. The apps a ruleset can pin a check to or let bypass.',
  })
  @ApiOkResponse({ type: ListRepositoryAppsResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  list(
    @Session() session: UserSession,
    @Param('username') username: string,
    @Param('repo') repo: string,
  ) {
    return this.installations.forRepository(session.user.id, username, repo);
  }
}
