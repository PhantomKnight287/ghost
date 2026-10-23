import { Controller, Get, Param, Query, Session } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { ErrorResponseDTO } from '../../domain/http.js';
import { RuleSuitesService } from '../../services/rulesets/rule-suites.service.js';
import {
  ListRuleSuitesQueryDTO,
  ListRuleSuitesResponseDTO,
} from './dto/rule-suite.dto.js';

@Controller('repositories/:username/:repo')
@ApiTags('Rulesets')
export class RuleSuitesController {
  constructor(private readonly ruleSuites: RuleSuitesService) {}

  @Get('rule-suites')
  @ApiOperation({
    summary: 'List rule insights',
    description:
      'Admins only. Every write the rulesets checked, one suite per ref, newest first. Pages are cursor-based: pass a response `nextCursor` back as `cursor`.',
  })
  @ApiOkResponse({ type: ListRuleSuitesResponseDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  list(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Query() query: ListRuleSuitesQueryDTO,
    @Session() session: UserSession,
  ): Promise<ListRuleSuitesResponseDTO> {
    return this.ruleSuites.list({
      username,
      repo,
      requesterId: session.user.id,
      query,
    });
  }
}
