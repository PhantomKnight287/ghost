import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import { RepositoryMaterializerService } from '../services/git/materializer/repository-materializer.service.js';
import { PackProcessService } from '../services/git/pack-process/pack-process.service.js';
import { RefAdvertisementService } from '../services/git/ref-advertisement/ref-advertisement.service.js';
import { RepositoryStorageService } from '../services/git/repository-storage/repository-storage.service.js';
import { PushTransactionService } from '../services/git/wal/push-transaction.service.js';
import { WalStoreService } from '../services/git/wal/wal-store.service.js';
import { S3Service } from '../services/s3/s3.service.js';
import { GitController } from './git.controller.js';
import { GIT_PACK_ROUTES } from './git.constants.js';
import { GitRawBodyMiddleware } from './middleware/git-raw-body.middleware.js';
import { GitService } from './git.service.js';

@Module({
  controllers: [GitController],
  providers: [
    GitService,
    PackProcessService,
    RefAdvertisementService,
    RepositoryStorageService,
    RepositoryMaterializerService,
    PushTransactionService,
    WalStoreService,
    S3Service,
  ],
})
export class GitModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(GitRawBodyMiddleware).forRoutes(...GIT_PACK_ROUTES);
  }
}
