import { Controller, Get } from '@nestjs/common';
import { Public } from '@thallesp/nestjs-better-auth';

import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Public: platform health checks run without credentials.
  @Get()
  @Public()
  getHello(): string {
    return this.appService.getHello();
  }
}
