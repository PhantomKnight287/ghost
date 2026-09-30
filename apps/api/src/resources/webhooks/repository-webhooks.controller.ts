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
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { ErrorResponseDTO } from '../../domain/http.js';
import {
  CreatedWebhookDTO,
  CreateWebhookRequestDTO,
  ListDeliveriesResponseDTO,
  ListWebhooksResponseDTO,
  UpdateWebhookRequestDTO,
  WebhookDTO,
  WebhookSecretDTO,
} from './dto/webhook.dto.js';
import { WebhooksService } from './webhooks.service.js';

@ApiTags('Webhooks')
@Controller('repositories/:username/:repo/webhooks')
export class RepositoryWebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  @ApiOperation({ summary: 'List webhooks', description: 'Admins only.' })
  @ApiOkResponse({ type: ListWebhooksResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  async list(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Session() session: UserSession,
  ): Promise<ListWebhooksResponseDTO> {
    return this.webhooks.list(await this.owner(username, repo, session));
  }

  @Post()
  @ApiOperation({
    summary: 'Create a webhook',
    description:
      'Sends the endpoint a `ping` right away. The response carries the signing secret, which is never shown again. Admins only.',
  })
  @ApiCreatedResponse({ type: CreatedWebhookDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDTO })
  async create(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Body() body: CreateWebhookRequestDTO,
    @Session() session: UserSession,
  ): Promise<CreatedWebhookDTO> {
    return this.webhooks.create(
      await this.owner(username, repo, session),
      body,
    );
  }

  @Patch(':webhookId')
  @ApiOperation({ summary: 'Update a webhook', description: 'Admins only.' })
  @ApiOkResponse({ type: WebhookDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  async update(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('webhookId') webhookId: string,
    @Body() body: UpdateWebhookRequestDTO,
    @Session() session: UserSession,
  ): Promise<WebhookDTO> {
    return this.webhooks.update(
      await this.owner(username, repo, session),
      webhookId,
      body,
    );
  }

  @Delete(':webhookId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a webhook',
    description: 'Pending deliveries are dropped. Admins only.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  async remove(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('webhookId') webhookId: string,
    @Session() session: UserSession,
  ): Promise<void> {
    return this.webhooks.remove(
      await this.owner(username, repo, session),
      webhookId,
    );
  }

  @Post(':webhookId/secret')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Replace a webhook's signing secret",
    description:
      'The old secret stops working at once, pending retries included. The response is the only time the new one is shown. Admins only.',
  })
  @ApiOkResponse({ type: WebhookSecretDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDTO })
  async rollSecret(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('webhookId') webhookId: string,
    @Session() session: UserSession,
  ): Promise<WebhookSecretDTO> {
    return this.webhooks.rollSecret(
      await this.owner(username, repo, session),
      webhookId,
    );
  }

  @Post(':webhookId/pings')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Send a test delivery',
    description: 'Queues a `ping`. Admins only.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  async ping(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('webhookId') webhookId: string,
    @Session() session: UserSession,
  ): Promise<void> {
    return this.webhooks.ping(
      await this.owner(username, repo, session),
      webhookId,
    );
  }

  @Get(':webhookId/deliveries')
  @ApiOperation({
    summary: 'List recent deliveries',
    description: 'The 50 most recent, each with its attempts. Admins only.',
  })
  @ApiOkResponse({ type: ListDeliveriesResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  async deliveries(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('webhookId') webhookId: string,
    @Session() session: UserSession,
  ): Promise<ListDeliveriesResponseDTO> {
    return this.webhooks.deliveries(
      await this.owner(username, repo, session),
      webhookId,
    );
  }

  @Post(':webhookId/deliveries/:deliveryId/redeliveries')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Redeliver',
    description:
      'Sends the same body again as a new delivery, with its own id and retries. Admins only.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  async redeliver(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('webhookId') webhookId: string,
    @Param('deliveryId') deliveryId: string,
    @Session() session: UserSession,
  ): Promise<void> {
    return this.webhooks.redeliver(
      await this.owner(username, repo, session),
      webhookId,
      deliveryId,
    );
  }

  private owner(username: string, repo: string, session: UserSession) {
    return this.webhooks.ofRepository({
      username,
      repo,
      requesterId: session.user.id,
    });
  }
}
