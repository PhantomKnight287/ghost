import { Module } from '@nestjs/common';
import { ReposService } from './repos.service.js';
import { ReposController } from './repos.controller.js';
import { RepositoryResolver } from '../../graphql/resolvers/repository/repository.resolver.js';
import { MaterializerModule } from '../../../materializer/materializer.module.js';
import { IssuesModule } from '../../../resources/issues/issues.module.js';
import { RepositoryAccessService } from '../../../services/git/repository-access/repository-access.service.js';

@Module({
  imports: [MaterializerModule, IssuesModule],
  controllers: [ReposController],
  providers: [ReposService, RepositoryResolver, RepositoryAccessService],
  exports: [RepositoryResolver],
})
export class ReposModule {}
