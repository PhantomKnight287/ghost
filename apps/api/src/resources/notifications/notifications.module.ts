import { Module } from '@nestjs/common';

import { OutboxService } from '../../services/events/outbox.service.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { NotifierService } from '../../services/notifications/notifier.service.js';
import { WebhookFanoutService } from '../../services/webhooks/webhook-fanout.service.js';
import { IssuesModule } from '../issues/issues.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { SubscriptionsController } from './subscriptions.controller.js';

@Module({
  imports: [IssuesModule],
  controllers: [NotificationsController, SubscriptionsController],
  providers: [
    NotificationsService,
    NotifierService,
    OutboxService,
    RepositoryAccessService,
    WebhookFanoutService,
  ],
})
export class NotificationsModule {}
