import { Controller, Get } from '@nestjs/common';
import { Public } from '@thallesp/nestjs-better-auth';

@Controller()
export class AppController {
  // Public: platform health checks run without credentials.
  @Get()
  @Public()
  getHello(): string {
    return 'Hello World!';
  }
}
