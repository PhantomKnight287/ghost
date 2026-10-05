import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  rateLimitPerMinute,
  rateLimitTracker,
} from '../../lib/http/rate-limit.js';
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
import { S3Service } from '../../services/s3/s3.service.js';
import { BranchesService } from '../../services/git/branches/branches.service.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { RepositoryContributionService } from '../../services/git/contributions/repository-contribution.service.js';
import { CommitSigningService } from '../../services/gpg/commit-signing.service.js';
import { CommitVerificationService } from '../../services/gpg/commit-verification.service.js';
import { CodeSearchService } from '../../services/git/code-search/code-search.service.js';

@Module({
  imports: [
    MaterializerModule,
    // Only code search is guarded: it is the one endpoint whose cost a query string decides. Counters live in this process, so with N replicas a client gets N times the limit.
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60_000,
          limit: (context) =>
            rateLimitPerMinute(context.switchToHttp().getRequest()),
        },
      ],
      getTracker: (request) => rateLimitTracker(request as Request),
      errorMessage: 'Too many searches. Try again in a minute.',
    }),
  ],
  controllers: [RepositoriesController, SearchController, TransfersController],
  providers: [
    RepositoriesService,
    UsersService,
    RepositoryStorageService,
    CodeSearchService,
    RepositoryPathIndexService,
    RepositoryLanguageService,
    WalStoreService,
    S3Service,
    BranchesService,
    RepositoryAccessService,
    RepositoryContributionService,
    CommitSigningService,
    CommitVerificationService,
  ],
  exports: [RepositoriesService],
})
export class RepositoriesModule {}
