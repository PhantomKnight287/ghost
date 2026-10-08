import { Module } from '@nestjs/common';

import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { AttachmentsController } from './attachments.controller.js';
import { AttachmentsService } from './attachments.service.js';

@Module({
  imports: [StorageModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsService, RepositoryAccessService],
})
export class AttachmentsModule {}
