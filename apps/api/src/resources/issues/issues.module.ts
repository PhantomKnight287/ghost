import { Module } from '@nestjs/common';

import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { IssueReferencesService } from '../../services/issues/issue-references.service.js';
import { UsersService } from '../../services/users/users.service.js';
import { IssuesController } from './issues.controller.js';
import { IssuesService } from './issues.service.js';
import { LabelsController } from './labels.controller.js';

@Module({
  controllers: [IssuesController, LabelsController],
  providers: [
    IssuesService,
    IssueReferencesService,
    UsersService,
    RepositoryAccessService,
  ],
  exports: [IssuesService, IssueReferencesService],
})
export class IssuesModule {}
