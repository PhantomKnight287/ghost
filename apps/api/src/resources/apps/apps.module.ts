import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import express from 'express';

import { AvatarsModule } from '../../avatars/avatars.module.js';
import {
  AVATAR_CONTENT_TYPES,
  AVATAR_MAX_BYTES,
} from '../../lib/avatars/avatar.constants.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { AppClientsService } from '../../services/apps/app-clients.service.js';
import { AppsController } from './apps.controller.js';
import { AppsService } from './apps.service.js';
import { OrganizationAppsController } from './organization-apps.controller.js';
import { PublicAppsController } from './public-apps.controller.js';

@Module({
  imports: [AvatarsModule, WebhooksModule],
  controllers: [
    AppsController,
    PublicAppsController,
    OrganizationAppsController,
  ],
  providers: [AppsService, AppClientsService],
})
export class AppsModule implements NestModule {
  // Logo uploads arrive as raw image bytes, the way avatars do.
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        express.raw({
          type: Object.keys(AVATAR_CONTENT_TYPES),
          limit: AVATAR_MAX_BYTES,
        }),
      )
      .forRoutes(AppsController);
  }
}
