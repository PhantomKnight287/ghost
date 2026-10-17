import { Module } from '@nestjs/common';

import { CommitStatusesModule } from '../../../resources/commit-statuses/commit-statuses.module.js';
import { GithubIssuesModule } from '../issues/issues.module.js';
import { GithubStatusesController } from './statuses.controller.js';
import { GithubStatusesService } from './statuses.service.js';

@Module({
  imports: [CommitStatusesModule, GithubIssuesModule],
  controllers: [GithubStatusesController],
  providers: [GithubStatusesService],
})
export class GithubStatusesModule {}
