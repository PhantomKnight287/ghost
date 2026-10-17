import { Module } from '@nestjs/common';

import { AttachmentsModule } from '../../../resources/attachments/attachments.module.js';
import { ReposModule } from '../repos/repos.module.js';
import { GithubUserAttachmentsController } from './user-attachments.controller.js';
import { GithubUserAttachmentsService } from './user-attachments.service.js';

@Module({
  imports: [AttachmentsModule, ReposModule],
  controllers: [GithubUserAttachmentsController],
  providers: [GithubUserAttachmentsService],
})
export class GithubUserAttachmentsModule {}
