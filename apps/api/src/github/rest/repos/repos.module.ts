import { Module } from '@nestjs/common';

import { MaterializerModule } from '../../../materializer/materializer.module.js';
import { IssuesModule } from '../../../resources/issues/issues.module.js';
import { PullRequestsModule } from '../../../resources/pull-requests/pull-requests.module.js';
import { RepositoriesModule } from '../../../resources/repositories/repositories.module.js';
import { RepositoryAccessService } from '../../../services/git/repository-access/repository-access.service.js';
import { CommitSigningService } from '../../../services/gpg/commit-signing.service.js';
import { CommitVerificationService } from '../../../services/gpg/commit-verification.service.js';
import { UsersService } from '../../../services/users/users.service.js';
import {
  IssueResolver,
  ProjectV2ItemResolver,
} from '../../graphql/resolvers/issue/issue.resolver.js';
import {
  CommitGitObjectResolver,
  RefResolver,
  RepositoryRefsResolver,
  TagResolver,
} from '../../graphql/resolvers/git-object/git-object.resolver.js';
import { GitObjectNodesService } from '../../graphql/resolvers/git-object/git-object-nodes.service.js';
import { IssueNodesService } from '../../graphql/resolvers/issue/issue-nodes.service.js';
import {
  CheckRunResolver,
  CommitResolver,
  GitActorResolver,
  PullRequestResolver,
  PullRequestReviewCommentResolver,
  PullRequestReviewResolver,
  PullRequestReviewThreadResolver,
  StatusCheckRollupResolver,
  StatusContextResolver,
} from '../../graphql/resolvers/pull-request/pull-request.resolver.js';
import { PullRequestNodesService } from '../../graphql/resolvers/pull-request/pull-request-nodes.service.js';
import {
  RepositoryOwnerResolver,
  RepositoryResolver,
  RepositoryRulesetResolver,
} from '../../graphql/resolvers/repository/repository.resolver.js';
import { RepositoryNodesService } from '../../graphql/resolvers/repository/repository-nodes.service.js';
import { GithubCodeownersController } from './codeowners.controller.js';
import { ReposController } from './repos.controller.js';
import { GithubReposService } from './repos.service.js';

@Module({
  imports: [
    MaterializerModule,
    IssuesModule,
    RepositoriesModule,
    PullRequestsModule,
  ],
  controllers: [ReposController, GithubCodeownersController],
  providers: [
    GithubReposService,
    RepositoryNodesService,
    IssueNodesService,
    PullRequestNodesService,
    RepositoryResolver,
    RepositoryOwnerResolver,
    RepositoryRulesetResolver,
    IssueResolver,
    PullRequestResolver,
    CommitResolver,
    GitActorResolver,
    PullRequestReviewResolver,
    PullRequestReviewThreadResolver,
    PullRequestReviewCommentResolver,
    StatusCheckRollupResolver,
    StatusContextResolver,
    CheckRunResolver,
    ProjectV2ItemResolver,
    RepositoryAccessService,
    CommitVerificationService,
    CommitSigningService,
    UsersService,
    GitObjectNodesService,
    RepositoryRefsResolver,
    RefResolver,
    TagResolver,
    CommitGitObjectResolver,
  ],
  exports: [
    RepositoryNodesService,
    IssueNodesService,
    PullRequestNodesService,
    GitObjectNodesService,
  ],
})
export class ReposModule {}
