import { Module } from '@nestjs/common';

import { SshSigningKeysController } from './ssh-signing-keys.controller.js';
import { SshSigningKeysService } from './ssh-signing-keys.service.js';

@Module({
  controllers: [SshSigningKeysController],
  providers: [SshSigningKeysService],
  exports: [SshSigningKeysService],
})
export class SshSigningKeysModule {}
