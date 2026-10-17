import { Body, Controller, Get, Param, Post, Session } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiNotFoundResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { OptionalAuth, type UserSession } from '@thallesp/nestjs-better-auth';

import { ErrorResponseDTO } from '../../domain/http.js';
import { CommitStatusesService } from './commit-statuses.service.js';
import {
  CombinedCommitStatusDTO,
  CommitStatusDTO,
  CreateCommitStatusRequestDTO,
} from './dto/commit-status.dto.js';

@Controller('repositories/:username/:slug')
@ApiTags('Commit statuses')
export class CommitStatusesController {
  constructor(private readonly statuses: CommitStatusesService) {}

  @Post('statuses/:sha')
  @ApiOperation({
    summary: 'Report a commit status',
    description:
      'Needs write access. `sha` is the full 40-character sha of a commit in the repository. Each report is a new entry; the newest per `context` is the current one.',
  })
  @ApiCreatedResponse({ type: CommitStatusDTO })
  @ApiBadRequestResponse({
    description: 'The body is not valid.',
    type: ErrorResponseDTO,
  })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiUnprocessableEntityResponse({
    description:
      'The sha is not a commit in the repository, or the commit already has 1000 statuses for this context.',
    type: ErrorResponseDTO,
  })
  createCommitStatus(
    @Param('username') username: string,
    @Param('slug') slug: string,
    @Param('sha') sha: string,
    @Body() body: CreateCommitStatusRequestDTO,
    @Session() session: UserSession,
  ): Promise<CommitStatusDTO> {
    return this.statuses.create({
      username,
      repo: slug,
      requesterId: session.user.id,
      sha,
      body,
    });
  }

  @Get('commits/:ref/status')
  @OptionalAuth()
  @ApiOperation({
    summary: 'Read the combined status of a commit',
    description:
      'The newest status per context, and the one state they add up to.',
  })
  @ApiOkResponse({ type: CombinedCommitStatusDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getCombinedCommitStatus(
    @Param('username') username: string,
    @Param('slug') slug: string,
    @Param('ref') ref: string,
    @Session() session: UserSession | undefined,
  ): Promise<CombinedCommitStatusDTO> {
    return this.statuses.combined({
      username,
      repo: slug,
      requesterId: session?.user?.id,
      ref,
    });
  }
}
