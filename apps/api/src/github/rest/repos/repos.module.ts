import { Module } from '@nestjs/common';
import { ReposService } from './repos.service.js';
import { ReposController } from './repos.controller.js';
import { RepositoryResolver } from '../../graphql/resolvers/repository/repository.resolver.js';
import { MaterializerModule } from '../../../materializer/materializer.module.js';
import { RepositoryAccessService } from '../../../services/git/repository-access/repository-access.service.js';

@Module({
  imports: [MaterializerModule],
  controllers: [ReposController],
  providers: [ReposService, RepositoryResolver, RepositoryAccessService],
})
export class ReposModule {}
