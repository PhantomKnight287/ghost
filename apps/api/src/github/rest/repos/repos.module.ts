import { Module } from '@nestjs/common';
import { ReposService } from './repos.service.js';
import { ReposController } from './repos.controller.js';
import {
  RepositoryOwnerResolver,
  RepositoryResolver,
} from '../../graphql/resolvers/repository/repository.resolver.js';
import {
  IssueResolver,
  ProjectV2ItemResolver,
} from '../../graphql/resolvers/issue/issue.resolver.js';
import {
  CommitResolver,
  GitActorResolver,
  PullRequestResolver,
  PullRequestReviewResolver,
  StatusCheckRollupResolver,
} from '../../graphql/resolvers/pull-request/pull-request.resolver.js';
import { PullRequestsModule } from '../../../resources/pull-requests/pull-requests.module.js';
import { MaterializerModule } from '../../../materializer/materializer.module.js';
import { IssuesModule } from '../../../resources/issues/issues.module.js';
import { RepositoriesModule } from '../../../resources/repositories/repositories.module.js';
import { RepositoryAccessService } from '../../../services/git/repository-access/repository-access.service.js';

@Module({
  imports: [
    MaterializerModule,
    IssuesModule,
    RepositoriesModule,
    PullRequestsModule,
  ],
  controllers: [ReposController],
  providers: [
    ReposService,
    RepositoryResolver,
    RepositoryOwnerResolver,
    IssueResolver,
    PullRequestResolver,
    CommitResolver,
    GitActorResolver,
    PullRequestReviewResolver,
    StatusCheckRollupResolver,
    ProjectV2ItemResolver,
    RepositoryAccessService,
  ],
  exports: [RepositoryResolver, IssueResolver],
})
export class ReposModule {}
