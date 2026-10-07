import { Module } from '@nestjs/common';

import { AvatarStorageService } from '../services/avatars/avatar-storage.service.js';

@Module({
  providers: [AvatarStorageService],
  exports: [AvatarStorageService],
})
export class AvatarsModule {}
