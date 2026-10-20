import { Module } from '@nestjs/common';

import { MaterializerModule } from '../../../materializer/materializer.module.js';
import { RulesetsModule } from '../../../resources/rulesets/rulesets.module.js';
import { RulesetVerdictsService } from '../../../services/rulesets/ruleset-verdicts.service.js';
import { GithubIssuesModule } from '../issues/issues.module.js';
import { GithubRulesetsController } from './rulesets.controller.js';
import { GithubRulesetsService } from './rulesets.service.js';

@Module({
  imports: [RulesetsModule, GithubIssuesModule, MaterializerModule],
  controllers: [GithubRulesetsController],
  providers: [GithubRulesetsService, RulesetVerdictsService],
})
export class GithubRulesetsModule {}
