import { Module } from '@nestjs/common';

import { InstallationAccessService } from '../../../services/apps/installation-access.service.js';
import { InstallationTokensService } from '../../../services/apps/installation-tokens.service.js';
import { UserTokensService } from '../../../services/apps/user-tokens.service.js';
import { AppClientsService } from '../../../services/apps/app-clients.service.js';
import { ReposModule } from '../repos/repos.module.js';
import { GithubApplicationsController } from './applications.controller.js';
import { GithubApplicationsService } from './applications.service.js';
import { GithubAppController } from './app.controller.js';
import { GithubAppService } from './app.service.js';
import { GithubInstallationLookupController } from './installation-lookup.controller.js';
import { GithubInstallationRepositoriesController } from './installation-repositories.controller.js';
import { GithubInstallationsController } from './installations.controller.js';
import { GithubInstallationsService } from './installations.service.js';
import { GithubUserInstallationsController } from './user-installations.controller.js';

@Module({
  imports: [ReposModule],
  controllers: [
    GithubAppController,
    GithubInstallationsController,
    GithubInstallationLookupController,
    GithubInstallationRepositoriesController,
    GithubUserInstallationsController,
    GithubApplicationsController,
  ],
  providers: [
    GithubAppService,
    GithubInstallationsService,
    InstallationTokensService,
    InstallationAccessService,
    UserTokensService,
    AppClientsService,
    GithubApplicationsService,
  ],
})
export class GithubAppModule {}
