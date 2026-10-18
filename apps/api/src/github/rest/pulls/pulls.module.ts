import { Module } from '@nestjs/common';

import { IssuesModule } from '../../../resources/issues/issues.module.js';
import { PullRequestsModule } from '../../../resources/pull-requests/pull-requests.module.js';
import { GithubIssuesModule } from '../issues/issues.module.js';
import { ReposModule } from '../repos/repos.module.js';
import { PullsController } from './pulls.controller.js';
import { GithubPullsService } from './pulls.service.js';
import { RequestedReviewersController } from './requested-reviewers.controller.js';
import { ReviewCommentsController } from './review-comments.controller.js';
import { GithubReviewCommentsService } from './review-comments.service.js';
import { GithubReviewsController } from './reviews.controller.js';
import { GithubReviewsService } from './reviews.service.js';

@Module({
  imports: [IssuesModule, PullRequestsModule, GithubIssuesModule, ReposModule],
  // ReviewCommentsController first: its `pulls/comments` routes must match before `pulls/:number`.
  controllers: [
    ReviewCommentsController,
    GithubReviewsController,
    RequestedReviewersController,
    PullsController,
  ],
  providers: [
    GithubPullsService,
    GithubReviewsService,
    GithubReviewCommentsService,
  ],
})
export class GithubPullsModule {}
