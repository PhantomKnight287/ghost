import { Module } from '@nestjs/common';

import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { ImportDispatcherService } from '../../services/imports/import-dispatcher.service.js';
import { ImportWriterService } from '../../services/imports/import-writer.service.js';
import { RepositoriesModule } from '../repositories/repositories.module.js';
import { ImporterCallbacksController } from './importer-callbacks.controller.js';
import { ImporterSecretGuard } from './importer-secret.guard.js';
import { ImportsController } from './imports.controller.js';
import { ImportsService } from './imports.service.js';

@Module({
  imports: [RepositoriesModule],
  controllers: [ImportsController, ImporterCallbacksController],
  providers: [
    ImportsService,
    ImportDispatcherService,
    ImportWriterService,
    ImporterSecretGuard,
    RepositoryAccessService,
  ],
})
export class ImportsModule {}
