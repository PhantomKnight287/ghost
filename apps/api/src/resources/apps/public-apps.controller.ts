import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Anonymous } from '../../auth/api-key-auth.guard.js';
import { ErrorResponseDTO } from '../../domain/http.js';
import { AppsService } from './apps.service.js';
import { PublicAppDTO } from './dto/app.dto.js';

/** Apart from AppsController, whose CookieOnly would refuse a token here: anyone may read an app's public page, signed in or not. */
@ApiTags('Apps')
@Controller('apps')
export class PublicAppsController {
  constructor(private readonly apps: AppsService) {}

  @Get(':slug')
  @Anonymous()
  @ApiOperation({ summary: "An app's public page" })
  @ApiOkResponse({ type: PublicAppDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  describe(@Param('slug') slug: string) {
    return this.apps.describe(slug);
  }
}
