import { Module } from '@nestjs/common';

import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { UsersService } from '../../services/users/users.service.js';
import { CollaboratorsController } from './collaborators.controller.js';
import { CollaboratorsService } from './collaborators.service.js';
import { InvitationsController } from './invitations.controller.js';

@Module({
  controllers: [CollaboratorsController, InvitationsController],
  providers: [CollaboratorsService, RepositoryAccessService, UsersService],
})
export class CollaboratorsModule {}
