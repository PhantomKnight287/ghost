import { Module } from '@nestjs/common';

import { ReleasesModule } from '../../../resources/releases/releases.module.js';
import { GithubIssuesModule } from '../issues/issues.module.js';
import { GithubReleasesController } from './releases.controller.js';
import { GithubReleasesService } from './releases.service.js';
import { GithubUploadsController } from './uploads.controller.js';

@Module({
  imports: [ReleasesModule, GithubIssuesModule],
  controllers: [GithubReleasesController, GithubUploadsController],
  providers: [GithubReleasesService],
})
export class GithubReleasesModule {}
