import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Session,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { ErrorResponseDTO } from '../../domain/http.js';
import { CollaboratorsService } from './collaborators.service.js';
import { ListInvitationsResponseDTO } from './dto/collaborator.dto.js';

@ApiTags('Collaborators')
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly collaborators: CollaboratorsService) {}

  @Get()
  @ApiOperation({
    summary: 'List my pending invitations',
    description:
      'Repositories the signed-in user has been invited to collaborate on.',
  })
  @ApiOkResponse({ type: ListInvitationsResponseDTO })
  list(@Session() session: UserSession): Promise<ListInvitationsResponseDTO> {
    return this.collaborators.listInvitations(session.user.id);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Accept an invitation' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  accept(@Param('id') id: string, @Session() session: UserSession) {
    return this.collaborators.acceptInvitation(id, session.user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Decline an invitation' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  decline(@Param('id') id: string, @Session() session: UserSession) {
    return this.collaborators.declineInvitation(id, session.user.id);
  }
}
