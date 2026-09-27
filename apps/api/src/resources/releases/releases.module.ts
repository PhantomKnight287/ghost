import { Module } from '@nestjs/common';

import { BranchesService } from '../../services/git/branches/branches.service.js';
import { MaterializerModule } from '../../materializer/materializer.module.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { RepositoryStorageService } from '../../services/git/repository-storage/repository-storage.service.js';
import { PushTransactionService } from '../../services/git/wal/push-transaction.service.js';
import { WalStoreService } from '../../services/git/wal/wal-store.service.js';
import { S3Service } from '../../services/s3/s3.service.js';
import { UsersService } from '../../services/users/users.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { ReleaseAssetsController } from './release-assets.controller.js';
import { ReleaseAssetsService } from './release-assets.service.js';
import { ReleasesController } from './releases.controller.js';
import { ReleasesService } from './releases.service.js';

@Module({
  imports: [MaterializerModule, StorageModule],
  controllers: [ReleasesController, ReleaseAssetsController],
  providers: [
    ReleasesService,
    ReleaseAssetsService,
    RepositoryAccessService,
    RepositoryStorageService,
    BranchesService,
    PushTransactionService,
    WalStoreService,
    S3Service,
    UsersService,
  ],
})
export class ReleasesModule {}
