import { Controller, Get } from '@nestjs/common';
import { Anonymous } from './auth/api-key-auth.guard.js';
import { NotRateLimited } from './rate-limit/rate-limit.guard.js';

@Controller()
export class AppController {
  // Public: platform health checks run without credentials.
  @Get()
  @Anonymous()
  @NotRateLimited()
  getHello(): string {
    return 'Hello World!';
  }
}
