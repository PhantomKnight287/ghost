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
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { ErrorResponseDTO } from '../../domain/http.js';
import {
  ForkRepositoryResponseDTO,
  ListIncomingTransfersResponseDTO,
} from './dto/fork-repository.dto.js';
import { RepositoriesService } from './repositories.service.js';

@ApiTags('Repositories')
@Controller('transfers')
export class TransfersController {
  constructor(private readonly repositories: RepositoriesService) {}

  @Get()
  @ApiOperation({
    summary: 'List transfers waiting for me',
    description:
      'Repositories offered to the signed-in user or to an organization they administer.',
  })
  @ApiOkResponse({ type: ListIncomingTransfersResponseDTO })
  list(
    @Session() session: UserSession,
  ): Promise<ListIncomingTransfersResponseDTO> {
    return this.repositories.listIncomingTransfers(session.user.id);
  }

  @Post(':repositoryId/accept')
  @ApiOperation({ summary: 'Accept a transfer' })
  @ApiOkResponse({ type: ForkRepositoryResponseDTO })
  @ApiConflictResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  accept(
    @Param('repositoryId') repositoryId: string,
    @Session() session: UserSession,
  ): Promise<ForkRepositoryResponseDTO> {
    return this.repositories.acceptTransfer(repositoryId, session.user.id);
  }

  @Delete(':repositoryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Decline or withdraw a transfer',
    description:
      'The recipient declines it, or whoever requested it withdraws it.',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  cancel(
    @Param('repositoryId') repositoryId: string,
    @Session() session: UserSession,
  ): Promise<void> {
    return this.repositories.cancelTransfer(repositoryId, session.user.id);
  }
}
