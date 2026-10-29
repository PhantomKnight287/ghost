import { Module } from '@nestjs/common';

import { InstallationsController } from './installations.controller.js';
import { InstallationsService } from './installations.service.js';
import { OrganizationInstallationsController } from './organization-installations.controller.js';
import { RepositoryAppsController } from './repository-apps.controller.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';

@Module({
  controllers: [
    InstallationsController,
    OrganizationInstallationsController,
    RepositoryAppsController,
  ],
  providers: [InstallationsService, RepositoryAccessService],
})
export class InstallationsModule {}
