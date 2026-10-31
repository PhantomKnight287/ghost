import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Session,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { CookieOnly } from '../../auth/api-key-auth.guard.js';
import { ErrorResponseDTO } from '../../domain/http.js';
import {
  CreateInstallationDTO,
  InstallationDTO,
  ListInstallationsResponseDTO,
  UpdateInstallationDTO,
} from './dto/installation.dto.js';
import { InstallationsService } from './installations.service.js';

@ApiTags('Installations')
@CookieOnly()
@Controller()
export class InstallationsController {
  constructor(private readonly installations: InstallationsService) {}

  @Post('apps/:slug/installations')
  @ApiOperation({
    summary: 'Install an app',
    description:
      'On your account or an organization you administer, for all its repositories or selected ones. The installation accepts the permissions and events the app asks for now.',
  })
  @ApiCreatedResponse({ type: InstallationDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDTO })
  install(
    @Session() session: UserSession,
    @Param('slug') slug: string,
    @Body() body: CreateInstallationDTO,
  ) {
    return this.installations.install(session.user.id, slug, body);
  }

  @Get('installations')
  @ApiOperation({ summary: 'List the apps installed on your account' })
  @ApiOkResponse({ type: ListInstallationsResponseDTO })
  list(@Session() session: UserSession) {
    return this.installations.list(session.user.id);
  }

  @Patch('installations/:id')
  @ApiOperation({ summary: "Change an installation's repositories" })
  @ApiOkResponse({ type: InstallationDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDTO })
  update(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Body() body: UpdateInstallationDTO,
  ) {
    return this.installations.update(session.user.id, id, body);
  }

  @Put('installations/:id/suspended')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Suspend an installation',
    description: 'Its tokens stop working and it cannot mint new ones.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  suspend(@Session() session: UserSession, @Param('id') id: string) {
    return this.installations.suspend(session.user.id, id);
  }

  @Delete('installations/:id/suspended')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unsuspend an installation' })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  unsuspend(@Session() session: UserSession, @Param('id') id: string) {
    return this.installations.unsuspend(session.user.id, id);
  }

  @Put('installations/:id/permissions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Accept an app's new permissions",
    description:
      'The installation takes the permissions and events the app asks for now. Nothing changes when there is nothing to review.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  acceptPermissions(@Session() session: UserSession, @Param('id') id: string) {
    return this.installations.acceptPermissions(session.user.id, id);
  }

  @Delete('installations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Uninstall an app',
    description: 'Its tokens stop working at once.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  uninstall(@Session() session: UserSession, @Param('id') id: string) {
    return this.installations.uninstall(session.user.id, id);
  }
}
