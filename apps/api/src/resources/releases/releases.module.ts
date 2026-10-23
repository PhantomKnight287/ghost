import { Module } from '@nestjs/common';

import { MaterializerModule } from '../../materializer/materializer.module.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { RuleSuitesService } from '../../services/rulesets/rule-suites.service.js';
import { RulesetVerdictsService } from '../../services/rulesets/ruleset-verdicts.service.js';
import { PushTransactionService } from '../../services/git/wal/push-transaction.service.js';
import { WalStoreService } from '../../services/git/wal/wal-store.service.js';
import { UsersService } from '../../services/users/users.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { ReleaseArchivesService } from './release-archives.service.js';
import { ReleaseAssetsController } from './release-assets.controller.js';
import { ReleaseAssetsService } from './release-assets.service.js';
import { ReleasesController } from './releases.controller.js';
import { ReleasesService } from './releases.service.js';
import { CommitStatusesModule } from '../../resources/commit-statuses/commit-statuses.module.js';
import { CommitVerificationService } from '../../services/gpg/commit-verification.service.js';
import { CommitSigningService } from '../../services/gpg/commit-signing.service.js';

@Module({
  imports: [CommitStatusesModule, MaterializerModule, StorageModule],
  controllers: [ReleasesController, ReleaseAssetsController],
  providers: [
    ReleasesService,
    ReleaseAssetsService,
    ReleaseArchivesService,
    RepositoryAccessService,
    PushTransactionService,
    RuleSuitesService,
    RulesetVerdictsService,
    CommitSigningService,
    CommitVerificationService,
    WalStoreService,
    UsersService,
  ],
  exports: [ReleasesService, ReleaseAssetsService, ReleaseArchivesService],
})
export class ReleasesModule {}
