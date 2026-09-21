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
  AddGpgKeyDTO,
  GpgKeyDTO,
  ListGpgKeysResponseDTO,
} from './dto/gpg-key.dto.js';
import { GpgKeysService } from './gpg-keys.service.js';

@ApiTags('GPG keys')
@Controller('gpg-keys')
export class GpgKeysController {
  constructor(private readonly keys: GpgKeysService) {}

  @Get()
  @ApiOperation({ summary: 'List the signing keys on the signed-in account' })
  @ApiOkResponse({ type: ListGpgKeysResponseDTO })
  list(@Session() session: UserSession) {
    return this.keys.list(session.user.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Add a public key to the signed-in account',
    description:
      'Commits signed with it read as verified once the key carries an ' +
      'address this account has verified.',
  })
  @ApiCreatedResponse({ type: GpgKeyDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiConflictResponse({ type: ErrorResponseDTO })
  add(@Session() session: UserSession, @Body() body: AddGpgKeyDTO) {
    return this.keys.add(session.user.id, body.publicKey);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a key',
    description:
      'Commits it signed stop reading as verified; nothing about the commits ' +
      'themselves changes.',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  remove(@Session() session: UserSession, @Param('id') id: string) {
    return this.keys.remove(session.user.id, id);
  }
}
