import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Redirect,
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
import { OptionalAuth, type UserSession } from '@thallesp/nestjs-better-auth';

import { ErrorResponseDTO } from '../../domain/http.js';
import {
  AddEmailDTO,
  ListEmailsResponseDTO,
  UserEmailDTO,
} from './dto/email.dto.js';
import { EmailsService } from './emails.service.js';

@ApiTags('Emails')
@Controller('emails')
export class EmailsController {
  constructor(private readonly emails: EmailsService) {}

  @Get()
  @ApiOperation({ summary: 'List the addresses on the signed-in account' })
  @ApiOkResponse({ type: ListEmailsResponseDTO })
  list(@Session() session: UserSession) {
    return this.emails.list(session.user.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Add an address to the signed-in account',
    description:
      'Mails a verification link. The address counts for nothing - sign-in, commit attribution - until that link is followed.',
  })
  @ApiCreatedResponse({ type: UserEmailDTO })
  @ApiConflictResponse({ type: ErrorResponseDTO })
  add(@Session() session: UserSession, @Body() body: AddEmailDTO) {
    return this.emails.add(session.user.id, body.email);
  }

  @Get('verify')
  @OptionalAuth()
  @Redirect()
  @ApiOperation({
    summary: 'Follow an address verification link',
    description: 'Redirects to the web app either way; the link is single use.',
  })
  async verify(@Query('token') token: string) {
    try {
      await this.emails.verify(token ?? '');
      return { url: this.emails.settingsUrl('verified') };
    } catch {
      return { url: this.emails.settingsUrl('invalid') };
    }
  }

  @Post(':id/resend')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Send the verification link again',
    description:
      'For the mail that never arrived or expired. The previous link stops working, and a resend is refused for a minute after the last one.',
  })
  @ApiNoContentResponse()
  @ApiConflictResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  resend(@Session() session: UserSession, @Param('id') id: string) {
    return this.emails.resend(session.user.id, id);
  }

  @Post(':id/primary')
  @ApiOperation({
    summary: 'Make a verified address the account address',
    description:
      'Swaps it with the current primary, which stays on the account as an extra so sign-in with it keeps working.',
  })
  @ApiOkResponse({ type: ListEmailsResponseDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  makePrimary(@Session() session: UserSession, @Param('id') id: string) {
    return this.emails.makePrimary(session.user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an address from the signed-in account' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  remove(@Session() session: UserSession, @Param('id') id: string) {
    return this.emails.remove(session.user.id, id);
  }
}
