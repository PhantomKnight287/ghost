import { Module } from '@nestjs/common';

import { IssuesModule } from '../../../resources/issues/issues.module.js';
import { PullRequestsModule } from '../../../resources/pull-requests/pull-requests.module.js';
import { GithubIssuesModule } from '../issues/issues.module.js';
import { ReposModule } from '../repos/repos.module.js';
import { PullsController } from './pulls.controller.js';
import { GithubPullsService } from './pulls.service.js';

@Module({
  imports: [IssuesModule, PullRequestsModule, GithubIssuesModule, ReposModule],
  controllers: [PullsController],
  providers: [GithubPullsService],
})
export class GithubPullsModule {}
