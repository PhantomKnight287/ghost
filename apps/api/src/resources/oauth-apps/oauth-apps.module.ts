import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import express from 'express';

import { AvatarsModule } from '../../avatars/avatars.module.js';
import {
  AVATAR_CONTENT_TYPES,
  AVATAR_MAX_BYTES,
} from '../../lib/avatars/avatar.constants.js';
import { OauthAppsController } from './oauth-apps.controller.js';
import { OauthAppsService } from './oauth-apps.service.js';

@Module({
  imports: [AvatarsModule],
  controllers: [OauthAppsController],
  providers: [OauthAppsService],
})
export class OauthAppsModule implements NestModule {
  // Logo uploads arrive as raw image bytes, the way avatars do.
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        express.raw({
          type: Object.keys(AVATAR_CONTENT_TYPES),
          limit: AVATAR_MAX_BYTES,
        }),
      )
      .forRoutes(OauthAppsController);
  }
}
