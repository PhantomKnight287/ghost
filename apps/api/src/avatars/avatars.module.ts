import { Module } from '@nestjs/common';

import { S3Service } from '../services/s3/s3.service.js';
import { AvatarStorageService } from '../services/avatars/avatar-storage.service.js';

@Module({
  providers: [AvatarStorageService, S3Service],
  exports: [AvatarStorageService],
})
export class AvatarsModule {}
