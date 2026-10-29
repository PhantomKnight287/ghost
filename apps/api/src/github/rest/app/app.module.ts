import { Module } from '@nestjs/common';

import { InstallationTokensService } from '../../../services/apps/installation-tokens.service.js';
import { ReposModule } from '../repos/repos.module.js';
import { GithubAppController } from './app.controller.js';
import { GithubAppService } from './app.service.js';
import { GithubInstallationLookupController } from './installation-lookup.controller.js';
import { GithubInstallationRepositoriesController } from './installation-repositories.controller.js';
import { GithubInstallationsController } from './installations.controller.js';
import { GithubInstallationsService } from './installations.service.js';

@Module({
  imports: [ReposModule],
  controllers: [
    GithubAppController,
    GithubInstallationsController,
    GithubInstallationLookupController,
    GithubInstallationRepositoriesController,
  ],
  providers: [
    GithubAppService,
    GithubInstallationsService,
    InstallationTokensService,
  ],
})
export class GithubAppModule {}
