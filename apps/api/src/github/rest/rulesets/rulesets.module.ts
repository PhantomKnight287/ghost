import { Module } from '@nestjs/common';

import { MaterializerModule } from '../../../materializer/materializer.module.js';
import { CommitStatusesModule } from '../../../resources/commit-statuses/commit-statuses.module.js';
import { RulesetsModule } from '../../../resources/rulesets/rulesets.module.js';
import { CommitSigningService } from '../../../services/gpg/commit-signing.service.js';
import { CommitVerificationService } from '../../../services/gpg/commit-verification.service.js';
import { RulesetVerdictsService } from '../../../services/rulesets/ruleset-verdicts.service.js';
import { UsersService } from '../../../services/users/users.service.js';
import { GithubIssuesModule } from '../issues/issues.module.js';
import { GithubRulesetsController } from './rulesets.controller.js';
import { GithubRulesetsService } from './rulesets.service.js';

@Module({
  imports: [
    CommitStatusesModule,
    RulesetsModule,
    GithubIssuesModule,
    MaterializerModule,
  ],
  controllers: [GithubRulesetsController],
  providers: [
    GithubRulesetsService,
    RulesetVerdictsService,
    CommitVerificationService,
    CommitSigningService,
    UsersService,
  ],
})
export class GithubRulesetsModule {}
