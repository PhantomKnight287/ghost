import { Module } from '@nestjs/common';

import { OauthController } from './oauth.controller.js';
import { OauthService } from './oauth.service.js';

@Module({
  controllers: [OauthController],
  providers: [OauthService],
})
export class OauthModule {}
