import { Module } from '@nestjs/common';

import { MaterializerModule } from '../../materializer/materializer.module.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { PushTransactionService } from '../../services/git/wal/push-transaction.service.js';
import { WalStoreService } from '../../services/git/wal/wal-store.service.js';
import { CommitSigningService } from '../../services/gpg/commit-signing.service.js';
import { CommitVerificationService } from '../../services/gpg/commit-verification.service.js';
import { S3Service } from '../../services/s3/s3.service.js';
import { LfsService } from '../../services/git/lfs/lfs.service.js';
import { UsersService } from '../../services/users/users.service.js';
import { IssuesModule } from '../issues/issues.module.js';
import { PullRefsModule } from '../../pull-refs/pull-refs.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { PullRequestsController } from './pull-requests.controller.js';
import { PullRequestsService } from './pull-requests.service.js';
import { ReviewsController } from './reviews.controller.js';
import { ReviewsService } from './reviews.service.js';

@Module({
  imports: [MaterializerModule, IssuesModule, PullRefsModule, StorageModule],
  controllers: [PullRequestsController, ReviewsController],
  providers: [
    PullRequestsService,
    ReviewsService,
    UsersService,
    RepositoryAccessService,
    PushTransactionService,
    WalStoreService,
    S3Service,
    LfsService,
    CommitSigningService,
    CommitVerificationService,
  ],
})
export class PullRequestsModule {}
