import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Session,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { SignInOptional } from '../../auth/api-key-auth.guard.js';
import { ErrorResponseDTO } from '../../domain/http.js';
import {
  ListRulesetsResponseDTO,
  ProtectedRefDTO,
  ProtectedRefsQueryDTO,
  ProtectedRefsResponseDTO,
  RulesetDTO,
  RulesetPatternsDTO,
  RulesetPreviewResponseDTO,
  RulesetRequestDTO,
} from './dto/ruleset.dto.js';
import { RulesetsService } from './rulesets.service.js';
import { TransformToLowercasePipe } from '../../pipes/transform-to-lowercase/transform-to-lowercase.pipe.js';

@Controller('repositories/:username/:repo')
@ApiTags('Rulesets')
@ApiExtraModels(ProtectedRefDTO)
export class RulesetsController {
  constructor(private readonly rulesets: RulesetsService) {}

  @Get('rulesets')
  @SignInOptional()
  @ApiOperation({
    summary: 'List rulesets',
    description: 'Oldest first. `bypassActors` is shown to admins only.',
  })
  @ApiOkResponse({ type: ListRulesetsResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  async list(
    @Param('username',TransformToLowercasePipe) username: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Session() session: UserSession | undefined,
  ): Promise<ListRulesetsResponseDTO> {
    return {
      rulesets: await this.rulesets.list({
        username,
        repo,
        requesterId: session?.user?.id,
      }),
    };
  }

  @Post('rulesets')
  @ApiOperation({
    summary: 'Create a ruleset',
    description: 'Admins only. Patterns are stored in full ref form.',
  })
  @ApiCreatedResponse({ type: RulesetDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiConflictResponse({
    description: 'A ruleset with that name exists.',
    type: ErrorResponseDTO,
  })
  @ApiUnprocessableEntityResponse({
    description:
      'A bypass actor names a team outside the organization, or a team or organization admin on a personal repository.',
    type: ErrorResponseDTO,
  })
  create(
    @Param('username',TransformToLowercasePipe) username: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Body() body: RulesetRequestDTO,
    @Session() session: UserSession,
  ): Promise<RulesetDTO> {
    return this.rulesets.create({
      username,
      repo,
      requesterId: session.user.id,
      body,
    });
  }

  @Post('rulesets/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Preview the refs patterns target',
    description:
      'Admins only. Matches the existing branches or tags exactly as enforcement would.',
  })
  @ApiOkResponse({ type: RulesetPreviewResponseDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  preview(
    @Param('username',TransformToLowercasePipe) username: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Body() patterns: RulesetPatternsDTO,
    @Session() session: UserSession,
  ): Promise<RulesetPreviewResponseDTO> {
    return this.rulesets.preview({
      username,
      repo,
      requesterId: session.user.id,
      patterns,
    });
  }

  @Get('rulesets/:id')
  @SignInOptional()
  @ApiOperation({
    summary: 'Get a ruleset',
    description: '`bypassActors` is shown to admins only.',
  })
  @ApiOkResponse({ type: RulesetDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  get(
    @Param('username',TransformToLowercasePipe) username: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Param('id') id: string,
    @Session() session: UserSession | undefined,
  ): Promise<RulesetDTO> {
    return this.rulesets.get({
      username,
      repo,
      requesterId: session?.user?.id,
      id,
    });
  }

  @Put('rulesets/:id')
  @ApiOperation({
    summary: 'Replace a ruleset',
    description:
      'Admins only. Rules and bypass actors become exactly the ones sent.',
  })
  @ApiOkResponse({ type: RulesetDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiConflictResponse({ type: ErrorResponseDTO })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDTO })
  update(
    @Param('username',TransformToLowercasePipe) username: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Param('id') id: string,
    @Body() body: RulesetRequestDTO,
    @Session() session: UserSession,
  ): Promise<RulesetDTO> {
    return this.rulesets.update({
      username,
      repo,
      requesterId: session.user.id,
      id,
      body,
    });
  }

  @Delete('rulesets/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a ruleset', description: 'Admins only.' })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  remove(
    @Param('username',TransformToLowercasePipe) username: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Param('id') id: string,
    @Session() session: UserSession,
  ): Promise<void> {
    return this.rulesets.remove({
      username,
      repo,
      requesterId: session.user.id,
      id,
    });
  }

  @Get('protected-refs')
  @SignInOptional()
  @ApiOperation({
    summary: 'Refs guarded by rulesets',
    description:
      'Each branch or tag an active ruleset targets, its rules, and how far the viewer may bypass them.',
  })
  @ApiOkResponse({ type: ProtectedRefsResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  protectedRefs(
    @Param('username',TransformToLowercasePipe) username: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Query() query: ProtectedRefsQueryDTO,
    @Session() session: UserSession | undefined,
  ): Promise<ProtectedRefsResponseDTO> {
    return this.rulesets.protectedRefs({
      username,
      repo,
      requesterId: session?.user?.id,
      refTarget: query.target,
    });
  }
}
