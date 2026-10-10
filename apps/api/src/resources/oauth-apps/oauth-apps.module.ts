import { Module } from '@nestjs/common';
import { OauthAppsService } from './oauth-apps.service.js';
import { OauthAppsController } from './oauth-apps.controller.js';

@Module({
  controllers: [OauthAppsController],
  providers: [OauthAppsService],
})
export class OauthAppsModule {}
