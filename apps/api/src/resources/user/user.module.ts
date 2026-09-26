import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import express from 'express';

import { AvatarsModule } from '../../avatars/avatars.module.js';
import { UsersService } from '../../services/users/users.service.js';
import {
  AVATAR_CONTENT_TYPES,
  AVATAR_MAX_BYTES,
} from '../../lib/avatars/avatar.constants.js';
import { UserController } from './user.controller.js';
import { UserService } from './user.service.js';

@Module({
  controllers: [UserController],
  imports: [AvatarsModule],
  providers: [UserService, UsersService],
})
export class UserModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        express.raw({
          type: Object.keys(AVATAR_CONTENT_TYPES),
          limit: AVATAR_MAX_BYTES,
        }),
      )
      .forRoutes(UserController);
  }
}
