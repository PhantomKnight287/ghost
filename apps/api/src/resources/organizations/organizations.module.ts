import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import express from 'express';

import {
  AVATAR_CONTENT_TYPES,
  AVATAR_MAX_BYTES,
} from '../../lib/avatars/avatar.constants.js';
import { AvatarsModule } from '../../avatars/avatars.module.js';
import { UsersService } from '../../services/users/users.service.js';
import {
  OrganizationInvitationsController,
  OrganizationsController,
  UserOrganizationsController,
} from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';
import { OrganizationTeamsController } from './teams.controller.js';
import { TeamsService } from './teams.service.js';

@Module({
  imports: [AvatarsModule],
  controllers: [
    OrganizationsController,
    UserOrganizationsController,
    OrganizationInvitationsController,
    OrganizationTeamsController,
  ],
  providers: [OrganizationsService, TeamsService, UsersService],
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
