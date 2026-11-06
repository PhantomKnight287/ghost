import { Module } from '@nestjs/common';

import { ChecksModule } from '../../../resources/checks/checks.module.js';
import { GithubAppModule } from '../app/app.module.js';
import { GithubIssuesModule } from '../issues/issues.module.js';
import { GithubChecksController } from './checks.controller.js';
import { GithubChecksService } from './checks.service.js';

@Module({
  imports: [ChecksModule, GithubIssuesModule, GithubAppModule],
  controllers: [GithubChecksController],
  providers: [GithubChecksService],
})
export class GithubChecksModule {}
