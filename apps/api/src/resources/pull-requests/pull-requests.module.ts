import { Module } from '@nestjs/common';

import { MaterializerModule } from '../../materializer/materializer.module.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { CodeownersService } from '../../services/codeowners/codeowners.service.js';
import { PullRequestRulesService } from '../../services/rulesets/pull-request-rules.service.js';
import { RuleSuitesService } from '../../services/rulesets/rule-suites.service.js';
import { RulesetVerdictsService } from '../../services/rulesets/ruleset-verdicts.service.js';
import { PushTransactionService } from '../../services/git/wal/push-transaction.service.js';
import { WalStoreService } from '../../services/git/wal/wal-store.service.js';
import { CommitSigningService } from '../../services/gpg/commit-signing.service.js';
import { CommitVerificationService } from '../../services/gpg/commit-verification.service.js';
import { LfsService } from '../../services/git/lfs/lfs.service.js';
import { UsersService } from '../../services/users/users.service.js';
import { CommitStatusesModule } from '../commit-statuses/commit-statuses.module.js';
import { IssuesModule } from '../issues/issues.module.js';
import { PullRefsModule } from '../../pull-refs/pull-refs.module.js';
import { StorageModule } from '../storage/storage.module.js';
import {
  PullRequestsController,
  ViewerPullRequestsController,
} from './pull-requests.controller.js';
import { PullRequestsService } from './pull-requests.service.js';
import { ReviewRequestsController } from './review-requests.controller.js';
import { ReviewRequestsService } from './review-requests.service.js';
import { ReviewThreadsService } from './review-threads.service.js';
import { ReviewsController } from './reviews.controller.js';
import { ReviewsService } from './reviews.service.js';

@Module({
  imports: [
    MaterializerModule,
    IssuesModule,
    PullRefsModule,
    StorageModule,
    CommitStatusesModule,
  ],
  controllers: [
    PullRequestsController,
    ViewerPullRequestsController,
    ReviewsController,
    ReviewRequestsController,
  ],
  providers: [
    PullRequestsService,
    ReviewsService,
    ReviewRequestsService,
    ReviewThreadsService,
    UsersService,
    RepositoryAccessService,
    PushTransactionService,
    RuleSuitesService,
    RulesetVerdictsService,
    PullRequestRulesService,
    CodeownersService,
    WalStoreService,
    LfsService,
    CommitSigningService,
    CommitVerificationService,
  ],
  exports: [
    PullRequestsService,
    ReviewsService,
    ReviewRequestsService,
    ReviewThreadsService,
    PullRequestRulesService,
  ],
})
export class PullRequestsModule {}
