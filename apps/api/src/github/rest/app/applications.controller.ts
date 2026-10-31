import {
  Body,
  Controller,
  Delete,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
  GithubScopedTokenRequestDTO,
} from './dto/installation.dto.js';

/** A Ghost App checks, resets, scopes and revokes its users' `ghu_` tokens with its client id and secret over HTTP Basic. */
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

  @Patch('token')
  @ApiOperation({
    summary: "Reset a token of the app's",
    description:
      'Returns a new token with the same scope; the old one stops working.',
  })
  @ApiOkResponse({ type: GithubAuthorizationDTO })
  reset(
    @Param('client_id') clientId: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: GithubApplicationTokenRequestDTO,
  ): Promise<GithubAuthorizationDTO> {
    return this.applications.reset(clientId, authorization, body.access_token);
  }

  @Post('token/scoped')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create a scoped token',
    description:
      'A new token limited to one account the app is installed on, some of its repositories and fewer permissions. It is never more than the original, which keeps working.',
  })
  @ApiOkResponse({ type: GithubAuthorizationDTO })
  scoped(
    @Param('client_id') clientId: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: GithubScopedTokenRequestDTO,
  ): Promise<GithubAuthorizationDTO> {
    return this.applications.scoped(clientId, authorization, body);
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
