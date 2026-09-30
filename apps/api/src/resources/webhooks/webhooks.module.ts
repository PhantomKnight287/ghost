import { Module } from '@nestjs/common';

import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { WebhookBreakerService } from '../../services/webhooks/webhook-breaker.service.js';
import { WebhookFanoutService } from '../../services/webhooks/webhook-fanout.service.js';
import { OrganizationWebhooksController } from './organization-webhooks.controller.js';
import { RepositoryWebhooksController } from './repository-webhooks.controller.js';
import { WebhooksService } from './webhooks.service.js';

@Module({
  controllers: [RepositoryWebhooksController, OrganizationWebhooksController],
  providers: [
    WebhooksService,
    RepositoryAccessService,
    WebhookFanoutService,
    WebhookBreakerService,
  ],
})
export class WebhooksModule {}
