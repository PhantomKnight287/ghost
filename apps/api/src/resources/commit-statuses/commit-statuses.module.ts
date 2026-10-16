import { Module } from '@nestjs/common';

import { MaterializerModule } from '../../materializer/materializer.module.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { CommitStatusesController } from './commit-statuses.controller.js';
import { CommitStatusesService } from './commit-statuses.service.js';

@Module({
  imports: [MaterializerModule],
  controllers: [CommitStatusesController],
  providers: [CommitStatusesService, RepositoryAccessService],
  exports: [CommitStatusesService],
})
export class CommitStatusesModule {}
