import { Module } from '@nestjs/common';

import { SshKeysModule } from '../../../resources/ssh-keys/ssh-keys.module.js';
import { SshSigningKeysModule } from '../../../resources/ssh-signing-keys/ssh-signing-keys.module.js';
import { UsersService } from '../../../services/users/users.service.js';
import { UsersController } from './users.controller.js';
import { GithubUsersService } from './users.service.js';

@Module({
  imports: [SshKeysModule, SshSigningKeysModule],
  controllers: [UsersController],
  providers: [UsersService, GithubUsersService],
})
export class UsersModule {}
