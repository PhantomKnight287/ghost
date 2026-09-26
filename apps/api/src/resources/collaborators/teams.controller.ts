import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Session,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { ErrorResponseDTO } from '../../domain/http.js';
import { CollaboratorsService } from './collaborators.service.js';
import {
  ListRepositoryTeamsResponseDTO,
  SetTeamRoleRequestDTO,
} from './dto/collaborator.dto.js';

@ApiTags('Collaborators')
@Controller('repositories/:username/:repo/teams')
export class TeamsController {
  constructor(private readonly collaborators: CollaboratorsService) {}

  @Get()
  @ApiOperation({
    summary: 'List teams and their access',
    description:
      "Every team in the repository's organization, with its role here or null. Admins only.",
  })
  @ApiOkResponse({ type: ListRepositoryTeamsResponseDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  list(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Session() session: UserSession,
  ): Promise<ListRepositoryTeamsResponseDTO> {
    return this.collaborators.listTeams({
      username,
      repo,
      requesterId: session.user.id,
    });
  }

  @Put(':teamId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Give a team a role',
    description:
      'Every member of the team gets the role on this repository. Admins only.',
  })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  setRole(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('teamId') teamId: string,
    @Body() body: SetTeamRoleRequestDTO,
    @Session() session: UserSession,
  ): Promise<void> {
    return this.collaborators.setTeamRole({
      username,
      repo,
      requesterId: session.user.id,
      teamId,
      role: body.role,
    });
  }

  @Delete(':teamId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove a team's access. Admins only." })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  remove(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('teamId') teamId: string,
    @Session() session: UserSession,
  ): Promise<void> {
    return this.collaborators.removeTeam({
      username,
      repo,
      requesterId: session.user.id,
      teamId,
    });
  }
}
