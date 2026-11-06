import { Module } from '@nestjs/common';

import { CommitStatusesModule } from '../commit-statuses/commit-statuses.module.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { ChecksService } from './checks.service.js';
import { CommitChecksService } from './commit-checks.service.js';

@Module({
  imports: [CommitStatusesModule],
  providers: [ChecksService, CommitChecksService, RepositoryAccessService],
  exports: [ChecksService, CommitChecksService, CommitStatusesModule],
})
export class ChecksModule {}
