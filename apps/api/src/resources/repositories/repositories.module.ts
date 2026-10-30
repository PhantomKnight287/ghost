import { Module } from '@nestjs/common';
import { PushTransactionService } from '../../services/git/wal/push-transaction.service.js';
import { RepositoriesService } from './repositories.service.js';
import { RepositoriesController } from './repositories.controller.js';
import { SearchController } from './search.controller.js';
import { TransfersController } from './transfers.controller.js';
import { UsersService } from '../../services/users/users.service.js';
import { RepositoryStorageService } from '../../services/git/repository-storage/repository-storage.service.js';
import { MaterializerModule } from '../../materializer/materializer.module.js';
import { RepositoryPathIndexService } from '../../services/git/path-index/repository-path-index.service.js';
import { RepositoryLanguageService } from '../../services/git/languages/repository-language.service.js';
import { WalStoreService } from '../../services/git/wal/wal-store.service.js';
import { CommitStatusesModule } from '../commit-statuses/commit-statuses.module.js';
import { ReleasesModule } from '../releases/releases.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { RepositoryContributionService } from '../../services/git/contributions/repository-contribution.service.js';
import { CommitSigningService } from '../../services/gpg/commit-signing.service.js';
import { CommitVerificationService } from '../../services/gpg/commit-verification.service.js';
import { CodeSearchService } from '../../services/git/code-search/code-search.service.js';
import { LfsService } from '../../services/git/lfs/lfs.service.js';
import { CodeownersService } from '../../services/codeowners/codeowners.service.js';
import { CodeownersController } from './codeowners.controller.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';

@Module({
  imports: [
    StorageModule,
    MaterializerModule,
    ReleasesModule,
    CommitStatusesModule,
    WebhooksModule,
  ],
  controllers: [
    RepositoriesController,
    SearchController,
    TransfersController,
    CodeownersController,
  ],
  providers: [
    RepositoriesService,
    UsersService,
    RepositoryStorageService,
    CodeSearchService,
    RepositoryPathIndexService,
    RepositoryLanguageService,
    WalStoreService,
    RepositoryAccessService,
    RepositoryContributionService,
    CommitSigningService,
    CommitVerificationService,
    LfsService,
    PushTransactionService,
    CodeownersService,
  ],
  exports: [RepositoriesService],
})
export class RepositoriesModule {}
