import { Module } from '@nestjs/common';

import { UsersService } from '../../services/users/users.service.js';
import { UserController } from './user.controller.js';
import { UserService } from './user.service.js';

@Module({
  controllers: [UserController],
  providers: [UserService, UsersService],
})
export class UserModule {}
