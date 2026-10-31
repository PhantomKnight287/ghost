import { Module } from '@nestjs/common';

import { RepositoryMaterializerService } from '../services/git/materializer/repository-materializer.service.js';
import { WalStoreService } from '../services/git/wal/wal-store.service.js';
import { RepositoryStorageService } from '../services/git/repository-storage/repository-storage.service.js';

// One materializer for the whole app: its in-flight map only prevents two replays of the same cache, and only lets `settle` wait for them, when every caller shares it.
@Module({
  providers: [
    RepositoryMaterializerService,
    WalStoreService,
    RepositoryStorageService,
  ],
  exports: [RepositoryMaterializerService],
})
export class MaterializerModule {}
