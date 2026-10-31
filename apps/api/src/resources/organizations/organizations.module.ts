import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import express from 'express';

import { AvatarsModule } from '../../avatars/avatars.module.js';
import {
  AVATAR_CONTENT_TYPES,
  AVATAR_MAX_BYTES,
} from '../../lib/avatars/avatar.constants.js';
import { UsersService } from '../../services/users/users.service.js';
import { OauthAppAccessController } from './oauth-app-access.controller.js';
import { OauthAppOrganizationsController } from './oauth-app-organizations.controller.js';
import { OauthAppAccessService } from './oauth-app-access.service.js';
import { OrganizationInvitationsController } from './organization-invitations.controller.js';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';
import { OrganizationTeamsController } from './teams.controller.js';
import { TeamsService } from './teams.service.js';
import { UserOrganizationsController } from './user-organizations.controller.js';

@Module({
  imports: [AvatarsModule],
  controllers: [
    OrganizationsController,
    UserOrganizationsController,
    OrganizationInvitationsController,
    OrganizationTeamsController,
    OauthAppAccessController,
    OauthAppOrganizationsController,
  ],
  providers: [
    OrganizationsService,
    TeamsService,
    UsersService,
    OauthAppAccessService,
  ],
})
export class OrganizationsModule implements NestModule {
  // Logo uploads arrive as raw image bytes, the way avatars do.
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        express.raw({
          type: Object.keys(AVATAR_CONTENT_TYPES),
          limit: AVATAR_MAX_BYTES,
        }),
      )
      .forRoutes(OrganizationsController);
  }
}
