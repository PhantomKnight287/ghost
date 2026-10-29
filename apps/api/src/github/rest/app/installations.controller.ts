import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { SignInOptional } from '../../../auth/api-key-auth.guard.js';
import type { GithubApp } from '../../auth/github-request.js';
import { CallingApp } from '../../auth/viewer.decorator.js';
import { ApiGithubErrors } from '../dto/error.dto.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubPageQueryDTO } from '../issues/dto/issue.dto.js';
import {
  GithubCreateInstallationTokenDTO,
  GithubInstallationDTO,
  GithubInstallationTokenDTO,
} from './dto/installation.dto.js';
import { GithubInstallationsService } from './installations.service.js';

/** The app's own installations, for a JWT. */
@Controller('v3/app/installations')
@ApiTags('GitHub compatibility')
@SignInOptional()
@UseFilters(GithubRestFilter)
@ApiGithubErrors()
export class GithubInstallationsController {
  constructor(private readonly installations: GithubInstallationsService) {}

  @Get()
  @ApiOperation({ summary: 'The installations of the app a JWT authenticates' })
  @ApiOkResponse({ type: [GithubInstallationDTO] })
  list(
    @CallingApp() app: GithubApp | null,
    @Query() query: GithubPageQueryDTO,
  ) {
    return this.installations.list(app, query);
  }

  @Get(':installation_id')
  @ApiOperation({ summary: 'One installation of the app' })
  @ApiOkResponse({ type: GithubInstallationDTO })
  get(
    @CallingApp() app: GithubApp | null,
    @Param('installation_id', ParseIntPipe) installationId: number,
  ) {
    return this.installations.get(app, installationId);
  }

  @Delete(':installation_id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Uninstall the app from an account',
    description: 'Its tokens stop working at once.',
  })
  @ApiNoContentResponse()
  remove(
    @CallingApp() app: GithubApp | null,
    @Param('installation_id', ParseIntPipe) installationId: number,
  ) {
    return this.installations.remove(app, installationId);
  }

  @Post(':installation_id/access_tokens')
  @ApiOperation({
    summary: 'Mint an installation token',
    description:
      "It expires in an hour, and can be narrowed to fewer permissions and repositories than the installation's.",
  })
  @ApiCreatedResponse({ type: GithubInstallationTokenDTO })
  mint(
    @CallingApp() app: GithubApp | null,
    @Param('installation_id', ParseIntPipe) installationId: number,
    @Body() body: GithubCreateInstallationTokenDTO,
  ) {
    return this.installations.mint(app, installationId, body);
  }
}
