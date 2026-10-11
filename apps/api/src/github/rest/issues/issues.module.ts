import { Module } from '@nestjs/common';

import { IssuesModule } from '../../../resources/issues/issues.module.js';
import { ReposModule } from '../repos/repos.module.js';
import { CommentsController } from './comments.controller.js';
import { IssuesController } from './issues.controller.js';
import { GithubIssuesService } from './issues.service.js';
import { LabelsController } from './labels.controller.js';

@Module({
  imports: [IssuesModule, ReposModule],
  // CommentsController first: its `issues/comments` routes must match before `issues/:number`.
  controllers: [CommentsController, LabelsController, IssuesController],
  providers: [GithubIssuesService],
})
export class GithubIssuesModule {}
