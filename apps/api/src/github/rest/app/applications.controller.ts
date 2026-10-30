import {
  Body,
  Controller,
  Delete,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseFilters,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { SignInOptional } from '../../../auth/api-key-auth.guard.js';
import { ApiGithubErrors } from '../dto/error.dto.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubApplicationsService } from './applications.service.js';
import {
  GithubApplicationTokenRequestDTO,
  GithubAuthorizationDTO,
} from './dto/installation.dto.js';

/** A Ghost App checks and revokes its users' `ghu_` tokens with its client id and secret over HTTP Basic. */
@Controller('v3/applications/:client_id')
@ApiTags('GitHub compatibility')
@SignInOptional()
@UseFilters(GithubRestFilter)
@ApiGithubErrors()
export class GithubApplicationsController {
  constructor(private readonly applications: GithubApplicationsService) {}

  @Post('token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Check a token of the app's" })
  @ApiOkResponse({ type: GithubAuthorizationDTO })
  check(
    @Param('client_id') clientId: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: GithubApplicationTokenRequestDTO,
  ): Promise<GithubAuthorizationDTO> {
    return this.applications.check(clientId, authorization, body.access_token);
  }

  @Delete('token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Revoke one token of the app's" })
  @ApiNoContentResponse()
  revoke(
    @Param('client_id') clientId: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: GithubApplicationTokenRequestDTO,
  ) {
    return this.applications.revoke(clientId, authorization, body.access_token);
  }

  @Delete('grant')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Revoke the app's authorization by the token's user",
  })
  @ApiNoContentResponse()
  revokeGrant(
    @Param('client_id') clientId: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: GithubApplicationTokenRequestDTO,
  ) {
    return this.applications.revokeGrant(
      clientId,
      authorization,
      body.access_token,
    );
  }
}
