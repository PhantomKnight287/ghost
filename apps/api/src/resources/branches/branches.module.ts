import { Module } from '@nestjs/common';

import { MaterializerModule } from '../../materializer/materializer.module.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { PushTransactionService } from '../../services/git/wal/push-transaction.service.js';
import { WalStoreService } from '../../services/git/wal/wal-store.service.js';
import { BranchesController } from './branches.controller.js';
import { RepositoryBranchesService } from './repository-branches.service.js';

@Module({
  imports: [MaterializerModule],
  controllers: [BranchesController],
  providers: [
    RepositoryBranchesService,
    RepositoryAccessService,
    PushTransactionService,
    WalStoreService,
  ],
})
export class BranchesModule {}
