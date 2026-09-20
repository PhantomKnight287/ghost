import { Module } from '@nestjs/common';

import { UsersService } from '../../services/users/users.service.js';
import { EmailsController } from './emails.controller.js';
import { EmailsService } from './emails.service.js';

@Module({
  controllers: [EmailsController],
  providers: [EmailsService, UsersService],
  exports: [EmailsService],
})
export class EmailsModule {}
