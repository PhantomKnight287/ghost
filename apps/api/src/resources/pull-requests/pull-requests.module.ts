import { Module } from '@nestjs/common';

import { RepositoryMaterializerService } from '../../services/git/materializer/repository-materializer.service.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { RepositoryStorageService } from '../../services/git/repository-storage/repository-storage.service.js';
import { PushTransactionService } from '../../services/git/wal/push-transaction.service.js';
import { WalStoreService } from '../../services/git/wal/wal-store.service.js';
import { S3Service } from '../../services/s3/s3.service.js';
import { UsersService } from '../../services/users/users.service.js';
import { PullRequestsController } from './pull-requests.controller.js';
import { PullRequestsService } from './pull-requests.service.js';

@Module({
  controllers: [PullRequestsController],
  providers: [
    PullRequestsService,
    UsersService,
    RepositoryAccessService,
    RepositoryStorageService,
    RepositoryMaterializerService,
    PushTransactionService,
    WalStoreService,
    S3Service,
  ],
})
export class PullRequestsModule {}
