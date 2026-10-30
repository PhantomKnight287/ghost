import { Module } from '@nestjs/common';

import { AppClientsService } from '../../services/apps/app-clients.service.js';
import { UserTokensService } from '../../services/apps/user-tokens.service.js';
import { OauthController } from './oauth.controller.js';
import { OauthService } from './oauth.service.js';

@Module({
  controllers: [OauthController],
  providers: [OauthService, AppClientsService, UserTokensService],
})
export class OauthModule {}
