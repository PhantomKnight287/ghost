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
  ApiUnprocessableEntityResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import type { Request } from 'express';

import { CookieOnly } from '../../auth/api-key-auth.guard.js';
import { ErrorResponseDTO } from '../../domain/http.js';
import { UploadAvatarResponseDTO } from '../user/dto/avatar.dto.js';
import { ListDeliveriesResponseDTO } from '../webhooks/dto/webhook.dto.js';
import { AppsService } from './apps.service.js';
import {
  AppDTO,
  CreateAppDTO,
  CreatedClientSecretDTO,
  CreatedPrivateKeyDTO,
  ListAppsResponseDTO,
  UpdateAppDTO,
} from './dto/app.dto.js';

@ApiTags('Apps')
@CookieOnly()
@Controller('apps')
export class AppsController {
  constructor(private readonly apps: AppsService) {}

  @Get()
  @ApiOperation({ summary: 'List the apps the signed-in account registered' })
  @ApiOkResponse({ type: ListAppsResponseDTO })
  list(@Session() session: UserSession) {
    return this.apps.list(session.user.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Register an app',
    description:
      'Creates its bot user, `slug[bot]`. The slug is made from the name now and never changes.',
  })
  @ApiCreatedResponse({ type: AppDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDTO })
  create(@Session() session: UserSession, @Body() body: CreateAppDTO) {
    return this.apps.create(session.user.id, body);
  }

  @Get(':slug/settings')
  @ApiOperation({ summary: 'One app, as its owner sees it' })
  @ApiOkResponse({ type: AppDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  get(@Session() session: UserSession, @Param('slug') slug: string) {
    return this.apps.get(session.user.id, slug);
  }

  @Patch(':slug')
  @ApiOperation({
    summary: 'Change an app',
    description: 'Renaming keeps the slug and the bot login.',
  })
  @ApiOkResponse({ type: AppDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDTO })
  update(
    @Session() session: UserSession,
    @Param('slug') slug: string,
    @Body() body: UpdateAppDTO,
  ) {
    return this.apps.update(session.user.id, slug, body);
  }

  @Delete(':slug')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an app',
    description:
      'Its keys stop working. Its bot stays, so what it did stays attributed, and its App ID and slug are never reused.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  remove(@Session() session: UserSession, @Param('slug') slug: string) {
    return this.apps.remove(session.user.id, slug);
  }

  @Post(':slug/private-keys')
  @ApiOperation({
    summary: 'Generate a private key',
    description:
      'The response carries the PEM. It is never shown again: Ghost keeps only the public half.',
  })
  @ApiCreatedResponse({ type: CreatedPrivateKeyDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDTO })
  createPrivateKey(
    @Session() session: UserSession,
    @Param('slug') slug: string,
  ) {
    return this.apps.createPrivateKey(session.user.id, slug);
  }

  @Delete(':slug/private-keys/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a private key',
    description: 'JWTs it signed stop working at once.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  removePrivateKey(
    @Session() session: UserSession,
    @Param('slug') slug: string,
    @Param('id') id: string,
  ) {
    return this.apps.removePrivateKey(session.user.id, slug, id);
  }

  @Post(':slug/client-secrets')
  @ApiOperation({
    summary: 'Generate a client secret',
    description:
      'The app signs users in with it on the OAuth flows. Shown once; at most 20.',
  })
  @ApiCreatedResponse({ type: CreatedClientSecretDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDTO })
  createClientSecret(
    @Session() session: UserSession,
    @Param('slug') slug: string,
  ): Promise<CreatedClientSecretDTO> {
    return this.apps.createClientSecret(session.user.id, slug);
  }

  @Delete(':slug/client-secrets/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a client secret',
    description: 'It stops working at once.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  removeClientSecret(
    @Session() session: UserSession,
    @Param('slug') slug: string,
    @Param('id') id: string,
  ) {
    return this.apps.removeClientSecret(session.user.id, slug, id);
  }

  @Get(':slug/webhook/deliveries')
  @ApiOperation({
    summary: "List an app's webhook deliveries",
    description: 'Newest first, with every attempt.',
  })
  @ApiOkResponse({ type: ListDeliveriesResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  webhookDeliveries(
    @Session() session: UserSession,
    @Param('slug') slug: string,
  ): Promise<ListDeliveriesResponseDTO> {
    return this.apps.webhookDeliveries(session.user.id, slug);
  }

  @Post(':slug/webhook/deliveries/:deliveryId/redeliveries')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Redeliver one of an app’s webhook deliveries',
    description: 'The same body again, as a new delivery.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  redeliverWebhook(
    @Session() session: UserSession,
    @Param('slug') slug: string,
    @Param('deliveryId') deliveryId: string,
  ) {
    return this.apps.redeliverWebhook(session.user.id, slug, deliveryId);
  }

  @Post(':slug/webhook/pings')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Send a ping to an app's webhook" })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  pingWebhook(@Session() session: UserSession, @Param('slug') slug: string) {
    return this.apps.pingWebhook(session.user.id, slug);
  }

  @Put(':slug/logo')
  @ApiOperation({
    summary: "Upload an app's logo",
    description:
      'Takes the raw image bytes, PNG or JPEG. The bot wears it as its avatar.',
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
    @Param('slug') slug: string,
    @Headers('content-type') contentType: string,
    @Req() request: Request,
  ): Promise<UploadAvatarResponseDTO> {
    return this.apps.setLogo(
      session.user.id,
      slug,
      contentType ?? '',
      Buffer.isBuffer(request.body) ? request.body : undefined,
    );
  }

  @Delete(':slug/logo')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove an app's logo" })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  removeLogo(@Session() session: UserSession, @Param('slug') slug: string) {
    return this.apps.removeLogo(session.user.id, slug);
  }
}
