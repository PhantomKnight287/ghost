import { Module } from '@nestjs/common';
import { RepositoriesService } from './repositories.service.js';
import { RepositoriesController } from './repositories.controller.js';
import { SearchController } from './search.controller.js';
import { TransfersController } from './transfers.controller.js';
import { UsersService } from '../../services/users/users.service.js';
import { RepositoryStorageService } from '../../services/git/repository-storage/repository-storage.service.js';
import { RepositoryMaterializerService } from '../../services/git/materializer/repository-materializer.service.js';
import { RepositoryPathIndexService } from '../../services/git/path-index/repository-path-index.service.js';
import { RepositoryLanguageService } from '../../services/git/languages/repository-language.service.js';
import { WalStoreService } from '../../services/git/wal/wal-store.service.js';
import { S3Service } from '../../services/s3/s3.service.js';
import { BranchesService } from '../../services/git/branches/branches.service.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { RepositoryContributionService } from '../../services/git/contributions/repository-contribution.service.js';
import { CommitVerificationService } from '../../services/gpg/commit-verification.service.js';
import { CodeSearchService } from '../../services/git/code-search/code-search.service.js';

@Module({
  controllers: [RepositoriesController, SearchController, TransfersController],
  providers: [
    RepositoriesService,
    UsersService,
    RepositoryStorageService,
    RepositoryMaterializerService,
    CodeSearchService,
    RepositoryPathIndexService,
    RepositoryLanguageService,
    WalStoreService,
    S3Service,
    BranchesService,
    RepositoryAccessService,
    RepositoryContributionService,
    CommitVerificationService,
  ],
})
export class RepositoriesModule {}
