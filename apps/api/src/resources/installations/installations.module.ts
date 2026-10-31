import { Module } from '@nestjs/common';

import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { InstallationsController } from './installations.controller.js';
import { InstallationsService } from './installations.service.js';
import { OrganizationInstallationsController } from './organization-installations.controller.js';
import { RepositoryAppsController } from './repository-apps.controller.js';

@Module({
  imports: [WebhooksModule],
  controllers: [
    InstallationsController,
    OrganizationInstallationsController,
    RepositoryAppsController,
  ],
  providers: [InstallationsService, RepositoryAccessService],
})
export class InstallationsModule {}
