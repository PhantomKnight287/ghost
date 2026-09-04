import { Module } from '@nestjs/common';
import { RepositoriesService } from './repositories.service.js';
import { RepositoriesController } from './repositories.controller.js';
import { UsersService } from '../../services/users/users.service.js';

@Module({
  controllers: [RepositoriesController],
  providers: [RepositoriesService,UsersService],
})
export class RepositoriesModule {}
