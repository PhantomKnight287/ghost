import { Module } from '@nestjs/common';

import { CommitStatusesModule } from '../commit-statuses/commit-statuses.module.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { ChecksService } from './checks.service.js';

@Module({
  imports: [CommitStatusesModule],
  providers: [ChecksService, RepositoryAccessService],
  exports: [ChecksService],
})
export class ChecksModule {}
