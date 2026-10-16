import { Module } from '@nestjs/common';

import { MaterializerModule } from '../../../materializer/materializer.module.js';
import { IssuesModule } from '../../../resources/issues/issues.module.js';
import { PullRequestsModule } from '../../../resources/pull-requests/pull-requests.module.js';
import { RepositoriesModule } from '../../../resources/repositories/repositories.module.js';
import { RepositoryAccessService } from '../../../services/git/repository-access/repository-access.service.js';
import {
  IssueResolver,
  ProjectV2ItemResolver,
} from '../../graphql/resolvers/issue/issue.resolver.js';
import { IssueNodesService } from '../../graphql/resolvers/issue/issue-nodes.service.js';
import {
  CheckRunResolver,
  CommitResolver,
  GitActorResolver,
  PullRequestResolver,
  PullRequestReviewResolver,
  StatusCheckRollupResolver,
  StatusContextResolver,
} from '../../graphql/resolvers/pull-request/pull-request.resolver.js';
import { PullRequestNodesService } from '../../graphql/resolvers/pull-request/pull-request-nodes.service.js';
import {
  RepositoryOwnerResolver,
  RepositoryResolver,
} from '../../graphql/resolvers/repository/repository.resolver.js';
import { RepositoryNodesService } from '../../graphql/resolvers/repository/repository-nodes.service.js';
import { ReposController } from './repos.controller.js';
import { GithubReposService } from './repos.service.js';

@Module({
  imports: [
    MaterializerModule,
    IssuesModule,
    RepositoriesModule,
    PullRequestsModule,
  ],
  controllers: [ReposController],
  providers: [
    GithubReposService,
    RepositoryNodesService,
    IssueNodesService,
    PullRequestNodesService,
    RepositoryResolver,
    RepositoryOwnerResolver,
    IssueResolver,
    PullRequestResolver,
    CommitResolver,
    GitActorResolver,
    PullRequestReviewResolver,
    StatusCheckRollupResolver,
    StatusContextResolver,
    CheckRunResolver,
    ProjectV2ItemResolver,
    RepositoryAccessService,
  ],
  exports: [RepositoryNodesService, IssueNodesService],
})
export class ReposModule {}
