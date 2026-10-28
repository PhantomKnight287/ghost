import { Module } from '@nestjs/common';

import { GithubAppController } from './app.controller.js';
import { GithubAppService } from './app.service.js';

@Module({
  controllers: [GithubAppController],
  providers: [GithubAppService],
})
export class GithubAppModule {}
