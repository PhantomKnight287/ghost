import {
  Body,
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
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { ErrorResponseDTO } from '../../domain/http.js';
import { AddSshKeyDTO } from '../ssh-keys/dto/ssh-key.dto.js';
import {
  ListSshSigningKeysResponseDTO,
  SshSigningKeyDTO,
} from './dto/ssh-signing-key.dto.js';
import { SshSigningKeysService } from './ssh-signing-keys.service.js';

@ApiTags('SSH signing keys')
@Controller('ssh-signing-keys')
export class SshSigningKeysController {
  constructor(private readonly keys: SshSigningKeysService) {}

  @Get()
  @ApiOperation({
    summary: 'List the SSH signing keys on the signed-in account',
  })
  @ApiOkResponse({ type: ListSshSigningKeysResponseDTO })
  list(@Session() session: UserSession) {
    return this.keys.list(session.user.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Add an SSH signing key to the signed-in account',
    description:
      'Commits signed with it verify when their author address is one this account has verified. It does not grant git access over SSH.',
  })
  @ApiCreatedResponse({ type: SshSigningKeyDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiConflictResponse({ type: ErrorResponseDTO })
  add(@Session() session: UserSession, @Body() body: AddSshKeyDTO) {
    return this.keys.add(session.user.id, body.publicKey, body.title);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a signing key',
    description: 'Commits it signed no longer verify.',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  remove(@Session() session: UserSession, @Param('id') id: string) {
    return this.keys.remove(session.user.id, { id });
  }
}
