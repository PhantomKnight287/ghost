import { Module } from '@nestjs/common';

import { UsersService } from '../../services/users/users.service.js';
import { GpgKeysController } from './gpg-keys.controller.js';
import { GpgKeysService } from './gpg-keys.service.js';

@Module({
  controllers: [GpgKeysController],
  providers: [GpgKeysService, UsersService],
})
export class GpgKeysModule {}
