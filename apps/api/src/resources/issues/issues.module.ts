import { Module } from '@nestjs/common';

import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { UsersService } from '../../services/users/users.service.js';
import { IssuesController } from './issues.controller.js';
import { IssuesService } from './issues.service.js';
import { LabelsController } from './labels.controller.js';

@Module({
  controllers: [IssuesController, LabelsController],
  providers: [IssuesService, UsersService, RepositoryAccessService],
})
export class IssuesModule {}
