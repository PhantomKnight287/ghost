import { Module } from '@nestjs/common';

import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { WebhookBreakerService } from '../../services/webhooks/webhook-breaker.service.js';
import { WebhookFanoutService } from '../../services/webhooks/webhook-fanout.service.js';
import { WebhooksController } from './webhooks.controller.js';
import { WebhooksService } from './webhooks.service.js';

@Module({
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    RepositoryAccessService,
    WebhookFanoutService,
    WebhookBreakerService,
  ],
})
export class WebhooksModule {}
