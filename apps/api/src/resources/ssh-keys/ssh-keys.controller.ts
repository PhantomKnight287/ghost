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
import {
  AddSshKeyDTO,
  ListSshKeysResponseDTO,
  SshKeyDTO,
} from './dto/ssh-key.dto.js';
import { SshKeysService } from './ssh-keys.service.js';

@ApiTags('SSH keys')
@Controller('ssh-keys')
export class SshKeysController {
  constructor(private readonly keys: SshKeysService) {}

  @Get()
  @ApiOperation({ summary: 'List the SSH keys on the signed-in account' })
  @ApiOkResponse({ type: ListSshKeysResponseDTO })
  list(@Session() session: UserSession) {
    return this.keys.list(session.user.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Add an SSH key to the signed-in account',
    description:
      'Anyone holding the matching private key can then fetch and push as this account over SSH.',
  })
  @ApiCreatedResponse({ type: SshKeyDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiConflictResponse({ type: ErrorResponseDTO })
  add(@Session() session: UserSession, @Body() body: AddSshKeyDTO) {
    return this.keys.add(session.user.id, body.publicKey, body.title);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a key',
    description: 'The next connection holding it is refused.',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  remove(@Session() session: UserSession, @Param('id') id: string) {
    return this.keys.remove(session.user.id, id);
  }
}
