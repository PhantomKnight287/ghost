import { Module } from '@nestjs/common';

import { SshKeysController } from './ssh-keys.controller.js';
import { SshKeysService } from './ssh-keys.service.js';

@Module({
  controllers: [SshKeysController],
  providers: [SshKeysService],
  exports: [SshKeysService],
})
export class SshKeysModule {}
