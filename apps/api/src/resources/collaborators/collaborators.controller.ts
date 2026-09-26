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
  CollaboratorDTO,
  InviteCollaboratorRequestDTO,
  ListCollaboratorsResponseDTO,
} from './dto/collaborator.dto.js';

@ApiTags('Collaborators')
@Controller('repositories/:username/:repo/collaborators')
export class CollaboratorsController {
  constructor(private readonly collaborators: CollaboratorsService) {}

  @Get()
  @ApiOperation({
    summary: 'List collaborators',
    description: 'Collaborators and pending invitations. Admins only.',
  })
  @ApiOkResponse({ type: ListCollaboratorsResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  list(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Session() session: UserSession,
  ): Promise<ListCollaboratorsResponseDTO> {
    return this.collaborators.list({
      username,
      repo,
      requesterId: session.user.id,
    });
  }

  @Put(':collaborator')
  @ApiOperation({
    summary: 'Invite a collaborator or change their role',
    description:
      'Invites the user, who gets access once they accept. For someone already invited or collaborating, changes the role. Admins only.',
  })
  @ApiOkResponse({ type: CollaboratorDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  invite(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('collaborator') collaborator: string,
    @Body() body: InviteCollaboratorRequestDTO,
    @Session() session: UserSession,
  ): Promise<CollaboratorDTO> {
    return this.collaborators.invite({
      username,
      repo,
      requesterId: session.user.id,
      collaborator,
      role: body.role,
    });
  }

  @Delete(':collaborator')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a collaborator',
    description:
      'Removes a collaborator or withdraws an invitation. Admins only, except that collaborators may remove themselves.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  remove(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('collaborator') collaborator: string,
    @Session() session: UserSession,
  ): Promise<void> {
    return this.collaborators.remove({
      username,
      repo,
      requesterId: session.user.id,
      collaborator,
    });
  }
}
