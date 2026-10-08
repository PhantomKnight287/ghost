import { Module } from '@nestjs/common';

import { MaterializerModule } from '../materializer/materializer.module.js';
import { StorageModule } from '../resources/storage/storage.module.js';
import { PullRefsService } from '../services/git/pull-refs/pull-refs.service.js';
import { PullRequestPushesService } from '../services/pull-requests/pull-request-pushes.service.js';
import { PushTransactionService } from '../services/git/wal/push-transaction.service.js';
import { WalStoreService } from '../services/git/wal/wal-store.service.js';

// One instance for the whole app: its in-flight map only coalesces syncs for a request when every caller shares it.
@Module({
  imports: [MaterializerModule, StorageModule],
  providers: [
    PullRefsService,
    PullRequestPushesService,
    PushTransactionService,
    WalStoreService,
  ],
  exports: [PullRefsService, PullRequestPushesService],
})
export class PullRefsModule {}
