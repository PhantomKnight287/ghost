import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import express from 'express';

import { S3Service } from '../../services/s3/s3.service.js';
import { UsersService } from '../../services/users/users.service.js';
import { RepositoryStorageService } from '../../services/git/repository-storage/repository-storage.service.js';
import { RepositoryMaterializerService } from '../../services/git/materializer/repository-materializer.service.js';
import { WalStoreService } from '../../services/git/wal/wal-store.service.js';
import { AVATAR_CONTENT_TYPES, AVATAR_MAX_BYTES } from './avatar.constants.js';
import { UserController } from './user.controller.js';
import { UserService } from './user.service.js';

@Module({
  controllers: [UserController],
  providers: [
    UserService,
    UsersService,
    RepositoryStorageService,
    RepositoryMaterializerService,
    WalStoreService,
    S3Service,
  ],
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
