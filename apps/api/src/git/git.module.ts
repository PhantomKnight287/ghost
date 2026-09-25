import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import { RepositoryMaterializerService } from '../services/git/materializer/repository-materializer.service.js';
import { PackProcessService } from '../services/git/pack-process/pack-process.service.js';
import { RefAdvertisementService } from '../services/git/ref-advertisement/ref-advertisement.service.js';
import { RepositoryStorageService } from '../services/git/repository-storage/repository-storage.service.js';
import { RepositoryContributionService } from '../services/git/contributions/repository-contribution.service.js';
import { PushTransactionService } from '../services/git/wal/push-transaction.service.js';
import { WalStoreService } from '../services/git/wal/wal-store.service.js';
import { S3Service } from '../services/s3/s3.service.js';
import { RepositoryAccessService } from '../services/git/repository-access/repository-access.service.js';
import { SshServerService } from '../services/git/ssh/ssh-server.service.js';
import { SshKeysModule } from '../resources/ssh-keys/ssh-keys.module.js';
import { IssuesModule } from '../resources/issues/issues.module.js';
import { GitController } from './git.controller.js';
import { GIT_PACK_ROUTES, GIT_TRANSPORT_ROUTES } from './git.constants.js';
import { GitRawBodyMiddleware } from './middleware/git-raw-body.middleware.js';
import { GitService } from './git.service.js';
import { CodeSearchService } from '../services/git/code-search/code-search.service.js';
import { GitBasicAuthMiddleware } from './middleware/git-basic-auth/git-basic-auth.middleware.js';

@Module({
  imports: [SshKeysModule, IssuesModule],
  controllers: [GitController],
  providers: [
    GitService,
    PackProcessService,
    RefAdvertisementService,
    RepositoryStorageService,
    RepositoryMaterializerService,
    RepositoryContributionService,
    CodeSearchService,
    PushTransactionService,
    WalStoreService,
    S3Service,
    RepositoryAccessService,
    GitBasicAuthMiddleware,
    SshServerService,
  ],
})
export class GitModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(GitBasicAuthMiddleware).forRoutes(...GIT_TRANSPORT_ROUTES);
    consumer.apply(GitRawBodyMiddleware).forRoutes(...GIT_PACK_ROUTES);
  }
}
