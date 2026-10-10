import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Session,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';

import { ErrorResponseDTO } from '../../domain/http.js';
import { UploadAvatarResponseDTO } from '../user/dto/avatar.dto.js';
import {
  AuthorizingOauthAppDTO,
  ListAuthorizedOauthAppsResponseDTO,
  CreatedOauthAppDTO,
  CreateOauthAppDTO,
  ListOauthAppsResponseDTO,
  OauthAppDTO,
  OauthAppSecretDTO,
  UpdateOauthAppDTO,
} from './dto/oauth-app.dto.js';
import { OauthAppsService } from './oauth-apps.service.js';

@ApiTags('OAuth apps')
@Controller('oauth-apps')
export class OauthAppsController {
  constructor(private readonly apps: OauthAppsService) {}

  @Get()
  @ApiOperation({
    summary: 'List the OAuth apps the signed-in account registered',
  })
  @ApiOkResponse({ type: ListOauthAppsResponseDTO })
  list(@Session() session: UserSession) {
    return this.apps.list(session.user.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Register an OAuth app',
    description:
      'The response carries the client secret. It is never shown again; rotate it to get a new one.',
  })
  @ApiCreatedResponse({ type: CreatedOauthAppDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  create(
    @Session() session: UserSession,
    @Body() body: CreateOauthAppDTO,
    @Req() request: Request,
  ) {
    return this.apps.create(
      fromNodeHeaders(request.headers),
      session.user.id,
      body,
    );
  }

  @Get('authorized')
  @ApiOperation({
    summary: 'List the OAuth apps the signed-in account authorized',
  })
  @ApiOkResponse({ type: ListAuthorizedOauthAppsResponseDTO })
  listAuthorized(@Session() session: UserSession) {
    return this.apps.listAuthorized(session.user.id);
  }

  @Delete('authorized/:clientId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke an OAuth app the signed-in account authorized',
    description:
      "Its keys for this account stop working, and it asks for consent again next time. Other accounts' keys are untouched.",
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  revokeAuthorized(
    @Session() session: UserSession,
    @Param('clientId') clientId: string,
  ) {
    return this.apps.revokeAuthorized(session.user.id, clientId);
  }

  @Get('authorize')
  @ApiOperation({
    summary: 'Describe an OAuth app to the user asked to authorize it',
    description:
      'Any enabled app, including ones built into Ghost. Never carries the secret.',
  })
  @ApiOkResponse({ type: AuthorizingOauthAppDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  describe(@Query('client_id') clientId: string) {
    return this.apps.describe(clientId);
  }

  @Get(':clientId')
  @ApiOperation({ summary: 'One OAuth app the signed-in account registered' })
  @ApiOkResponse({ type: OauthAppDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  get(@Session() session: UserSession, @Param('clientId') clientId: string) {
    return this.apps.get(session.user.id, clientId);
  }

  @Patch(':clientId')
  @ApiOperation({ summary: 'Change an OAuth app' })
  @ApiOkResponse({ type: OauthAppDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  update(
    @Session() session: UserSession,
    @Param('clientId') clientId: string,
    @Body() body: UpdateOauthAppDTO,
    @Req() request: Request,
  ) {
    return this.apps.update(
      fromNodeHeaders(request.headers),
      session.user.id,
      clientId,
      body,
    );
  }

  @Post(':clientId/secret')
  @ApiOperation({
    summary: "Replace an OAuth app's client secret",
    description: 'The previous secret stops working at once.',
  })
  @ApiCreatedResponse({ type: OauthAppSecretDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  rotateSecret(
    @Session() session: UserSession,
    @Param('clientId') clientId: string,
    @Req() request: Request,
  ) {
    return this.apps.rotateSecret(
      fromNodeHeaders(request.headers),
      session.user.id,
      clientId,
    );
  }

  @Put(':clientId/logo')
  @ApiOperation({
    summary: "Upload an OAuth app's logo",
    description:
      'Takes the raw image bytes, PNG or JPEG. Users see it when they are asked to authorize the app.',
  })
  @ApiConsumes('image/png', 'image/jpeg')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiOkResponse({ type: UploadAvatarResponseDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiUnsupportedMediaTypeResponse({ type: ErrorResponseDTO })
  setLogo(
    @Session() session: UserSession,
    @Param('clientId') clientId: string,
    @Headers('content-type') contentType: string,
    @Req() request: Request,
  ): Promise<UploadAvatarResponseDTO> {
    return this.apps.setLogo(
      session.user.id,
      clientId,
      contentType ?? '',
      Buffer.isBuffer(request.body) ? request.body : undefined,
    );
  }

  @Delete(':clientId/logo')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove an OAuth app's logo" })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  removeLogo(
    @Session() session: UserSession,
    @Param('clientId') clientId: string,
  ) {
    return this.apps.removeLogo(session.user.id, clientId);
  }

  @Delete(':clientId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an OAuth app',
    description: 'Every key the app was issued, for every user, stops working.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  remove(
    @Session() session: UserSession,
    @Param('clientId') clientId: string,
    @Req() request: Request,
  ) {
    return this.apps.remove(
      fromNodeHeaders(request.headers),
      session.user.id,
      clientId,
    );
  }
}
