import { Module } from '@nestjs/common';

import { MaterializerModule } from '../../materializer/materializer.module.js';
import { BranchesService } from '../../services/git/branches/branches.service.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { PushTransactionService } from '../../services/git/wal/push-transaction.service.js';
import { WalStoreService } from '../../services/git/wal/wal-store.service.js';
import { S3Service } from '../../services/s3/s3.service.js';
import { BranchesController } from './branches.controller.js';
import { RepositoryBranchesService } from './repository-branches.service.js';

@Module({
  imports: [MaterializerModule],
  controllers: [BranchesController],
  providers: [
    RepositoryBranchesService,
    RepositoryAccessService,
    BranchesService,
    PushTransactionService,
    WalStoreService,
    S3Service,
  ],
})
export class BranchesModule {}
