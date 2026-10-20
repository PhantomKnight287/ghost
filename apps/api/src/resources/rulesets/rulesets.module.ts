import { Module } from '@nestjs/common';

import { MaterializerModule } from '../../materializer/materializer.module.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { RulesetVerdictsService } from '../../services/rulesets/ruleset-verdicts.service.js';
import { RulesetsController } from './rulesets.controller.js';
import { RulesetsService } from './rulesets.service.js';

@Module({
  imports: [MaterializerModule],
  controllers: [RulesetsController],
  providers: [RulesetsService, RepositoryAccessService, RulesetVerdictsService],
  exports: [RulesetsService],
})
export class RulesetsModule {}
