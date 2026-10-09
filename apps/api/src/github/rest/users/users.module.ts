import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { UsersService } from '../../../services/users/users.service.js';
import { SshKeysModule } from '../../../resources/ssh-keys/ssh-keys.module.js';

@Module({
  imports: [SshKeysModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
