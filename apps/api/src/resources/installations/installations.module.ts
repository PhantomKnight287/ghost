import { Module } from '@nestjs/common';

import { InstallationsController } from './installations.controller.js';
import { InstallationsService } from './installations.service.js';
import { OrganizationInstallationsController } from './organization-installations.controller.js';

@Module({
  controllers: [InstallationsController, OrganizationInstallationsController],
  providers: [InstallationsService],
})
export class InstallationsModule {}
