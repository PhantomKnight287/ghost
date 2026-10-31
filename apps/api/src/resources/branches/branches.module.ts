import { Module } from '@nestjs/common';

import { MaterializerModule } from '../../materializer/materializer.module.js';
import { CommitStatusesModule } from '../../resources/commit-statuses/commit-statuses.module.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { PushTransactionService } from '../../services/git/wal/push-transaction.service.js';
import { WalStoreService } from '../../services/git/wal/wal-store.service.js';
import { CommitSigningService } from '../../services/gpg/commit-signing.service.js';
import { CommitVerificationService } from '../../services/gpg/commit-verification.service.js';
import { RuleSuitesService } from '../../services/rulesets/rule-suites.service.js';
import { RulesetVerdictsService } from '../../services/rulesets/ruleset-verdicts.service.js';
import { UsersService } from '../../services/users/users.service.js';
import { BranchesController } from './branches.controller.js';
import { RepositoryBranchesService } from './repository-branches.service.js';

@Module({
  imports: [CommitStatusesModule, MaterializerModule],
  controllers: [BranchesController],
  providers: [
    RepositoryBranchesService,
    RepositoryAccessService,
    PushTransactionService,
    RuleSuitesService,
    RulesetVerdictsService,
    UsersService,
    CommitSigningService,
    CommitVerificationService,
    WalStoreService,
  ],
  exports: [RepositoryBranchesService],
})
export class BranchesModule {}
