import { Module } from '@nestjs/common';

import { StorageQuotaService } from '../../services/storage/storage-quota.service.js';
import { StorageController } from './storage.controller.js';
import { StorageService } from './storage.service.js';

@Module({
  controllers: [StorageController],
  providers: [StorageService, StorageQuotaService],
  exports: [StorageQuotaService],
})
export class StorageModule {}
