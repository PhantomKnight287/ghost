import { Module } from '@nestjs/common';

import { MaterializerModule } from '../materializer/materializer.module.js';
import { StorageModule } from '../resources/storage/storage.module.js';
import { PullRefsService } from '../services/git/pull-refs/pull-refs.service.js';
import { PushTransactionService } from '../services/git/wal/push-transaction.service.js';
import { WalStoreService } from '../services/git/wal/wal-store.service.js';
import { S3Service } from '../services/s3/s3.service.js';

// One instance for the whole app: its in-flight map only coalesces syncs for a request when every caller shares it.
@Module({
  imports: [MaterializerModule, StorageModule],
  providers: [
    PullRefsService,
    PushTransactionService,
    WalStoreService,
    S3Service,
  ],
  exports: [PullRefsService],
})
export class PullRefsModule {}
