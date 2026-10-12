import { Module } from '@nestjs/common';

import { BranchesModule } from '../../../resources/branches/branches.module.js';
import { ReleasesModule } from '../../../resources/releases/releases.module.js';
import { GithubIssuesModule } from '../issues/issues.module.js';
import { GithubGitController } from './git.controller.js';

@Module({
  imports: [BranchesModule, ReleasesModule, GithubIssuesModule],
  controllers: [GithubGitController],
})
export class GithubGitModule {}
