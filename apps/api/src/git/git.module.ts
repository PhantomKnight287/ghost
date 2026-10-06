import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { json } from 'express';

import { MaterializerModule } from '../materializer/materializer.module.js';
import { PackProcessService } from '../services/git/pack-process/pack-process.service.js';
import { RefAdvertisementService } from '../services/git/ref-advertisement/ref-advertisement.service.js';
import { RepositoryContributionService } from '../services/git/contributions/repository-contribution.service.js';
import { PushTransactionService } from '../services/git/wal/push-transaction.service.js';
import { WalStoreService } from '../services/git/wal/wal-store.service.js';
import { S3Service } from '../services/s3/s3.service.js';
import { RepositoryAccessService } from '../services/git/repository-access/repository-access.service.js';
import { SshServerService } from '../services/git/ssh/ssh-server.service.js';
import { SshKeysModule } from '../resources/ssh-keys/ssh-keys.module.js';
import { IssuesModule } from '../resources/issues/issues.module.js';
import { PullRefsModule } from '../pull-refs/pull-refs.module.js';
import { StorageModule } from '../resources/storage/storage.module.js';
import { GitController } from './git.controller.js';
import {
  GIT_PACK_ROUTES,
  GIT_TRANSPORT_ROUTES,
  LFS_ROUTES,
} from './git.constants.js';
import { LfsController } from './lfs.controller.js';
import { LfsLocksController } from './lfs-locks.controller.js';
import { LfsLocksService } from '../services/git/lfs/lfs-locks.service.js';
import { LFS_MEDIA_TYPE } from '../lib/git/lfs/lfs-objects.js';
import { LfsService } from '../services/git/lfs/lfs.service.js';
import { GitRawBodyMiddleware } from './middleware/git-raw-body.middleware.js';
import { GitService } from './git.service.js';
import { CodeSearchService } from '../services/git/code-search/code-search.service.js';
import { GitBasicAuthMiddleware } from './middleware/git-basic-auth/git-basic-auth.middleware.js';

@Module({
  imports: [
    MaterializerModule,
    SshKeysModule,
    IssuesModule,
    PullRefsModule,
    StorageModule,
  ],
  controllers: [GitController, LfsController, LfsLocksController],
  providers: [
    GitService,
    PackProcessService,
    RefAdvertisementService,
    RepositoryContributionService,
    CodeSearchService,
    PushTransactionService,
    WalStoreService,
    S3Service,
    RepositoryAccessService,
    GitBasicAuthMiddleware,
    SshServerService,
    LfsService,
    LfsLocksService,
  ],
})
export class GitModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Parsed ahead of authorization, which reads the operation from it.
    consumer.apply(json({ type: LFS_MEDIA_TYPE })).forRoutes(...LFS_ROUTES);
    consumer.apply(GitBasicAuthMiddleware).forRoutes(...GIT_TRANSPORT_ROUTES);
    consumer.apply(GitRawBodyMiddleware).forRoutes(...GIT_PACK_ROUTES);
  }
}
