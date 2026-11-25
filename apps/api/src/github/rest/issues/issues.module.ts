import { Module } from '@nestjs/common';

import { IssuesModule } from '../../../resources/issues/issues.module.js';
import { GithubSearchService } from '../../graphql/resolvers/search/search.service.js';
import { ReposModule } from '../repos/repos.module.js';
import { CommentsController } from './comments.controller.js';
import { GithubCommentsService } from './comments.service.js';
import { IssuesController } from './issues.controller.js';
import { GithubIssuesService } from './issues.service.js';
import { LabelsController } from './labels.controller.js';
import { GithubLabelsService } from './labels.service.js';
import { SearchIssuesController } from './search.controller.js';
import { GithubSearchIssuesService } from './search.service.js';

@Module({
  imports: [IssuesModule, ReposModule],
  // CommentsController first: its `issues/comments` routes must match before `issues/:number`.
  controllers: [
    CommentsController,
    LabelsController,
    IssuesController,
    SearchIssuesController,
  ],
  providers: [
    GithubIssuesService,
    GithubCommentsService,
    GithubLabelsService,
    GithubSearchService,
    GithubSearchIssuesService,
  ],
  exports: [GithubIssuesService, GithubSearchService],
})
export class GithubIssuesModule {}
