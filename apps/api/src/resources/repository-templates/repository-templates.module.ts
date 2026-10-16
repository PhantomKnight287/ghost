import { Module } from '@nestjs/common';
import { RepositoryTemplatesController } from './repository-templates.controller.js';
import { RepositoryTemplatesService } from './repository-templates.service.js';

@Module({
  controllers: [RepositoryTemplatesController],
  providers: [RepositoryTemplatesService],
})
export class RepositoryTemplatesModule {}
