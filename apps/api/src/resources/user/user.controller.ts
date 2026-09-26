import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
  Req,
  Res,
  Session,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { OptionalAuth, type UserSession } from '@thallesp/nestjs-better-auth';
import type { Request, Response } from 'express';

import { ErrorResponseDTO } from '../../domain/http.js';
import { AVATAR_NAME_PATTERN } from '../../lib/avatars/avatar.constants.js';
import { AvatarNotFoundError } from '../../lib/avatars/avatar.errors.js';
import { AvatarStorageService } from '../../services/avatars/avatar-storage.service.js';
import { UploadAvatarResponseDTO } from './dto/avatar.dto.js';
import {
  GetUserContributionsQueryDTO,
  GetUserContributionsResponseDTO,
} from './dto/contributions.dto.js';
import { UserProfileResponseDTO } from './dto/profile.dto.js';
import { UserService } from './user.service.js';

@ApiTags('Users')
@Controller('users')
export class UserController {
  constructor(
    private readonly users: UserService,
    private readonly avatars: AvatarStorageService,
  ) {}

  @Put('avatar')
  @ApiOperation({
    summary: 'Upload the signed-in user’s avatar',
    description:
      'Takes the raw image bytes. Returns the URL to store on the user; writing `user.image` stays with Better Auth’s `update-user`.',
  })
  @ApiConsumes('image/png', 'image/jpeg')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiOkResponse({ type: UploadAvatarResponseDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiUnsupportedMediaTypeResponse({ type: ErrorResponseDTO })
  uploadAvatar(
    @Req() request: Request,
    @Headers('content-type') contentType: string,
    @Session() session: UserSession,
  ) {
    return this.avatars.store({
      ownerId: session.user.id,
      contentType: contentType ?? '',
      body: Buffer.isBuffer(request.body) ? request.body : undefined,
    });
  }

  @Delete('avatar')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete the signed-in user’s stored avatar' })
  @ApiNoContentResponse()
  deleteAvatar(@Session() session: UserSession) {
    return this.avatars.remove(session.user.id);
  }

  @Get('avatars/:userId/:name')
  @OptionalAuth()
  @ApiOperation({ summary: 'Serve a stored avatar' })
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  async getAvatar(
    @Param('userId') userId: string,
    @Param('name') name: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    // Only names this service generates; nothing user-authored reaches S3.
    if (!AVATAR_NAME_PATTERN.test(name)) throw new AvatarNotFoundError();

    const avatar = await this.avatars.get(userId, name);

    response.set({
      'Content-Type': avatar.contentType,
      ...(avatar.size ? { 'Content-Length': String(avatar.size) } : {}),
      'X-Content-Type-Options': 'nosniff',
      // A new upload gets a new name, so a hit can never be stale.
      'Cache-Control': 'public, max-age=31536000, immutable',
    });

    return new StreamableFile(avatar.stream);
  }

  @Get(':username')
  @OptionalAuth()
  @ApiOperation({ summary: "Read a user's public profile" })
  @ApiOkResponse({ type: UserProfileResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getProfile(@Param('username') username: string) {
    return this.users.getProfile(username);
  }

  @Get(':username/contributions')
  @OptionalAuth()
  @ApiOperation({
    summary: "Read a user's contribution calendar",
    description:
      'Daily commit counts for a calendar year, across the repositories the requester may see that the user owns. Days are UTC, in order.',
  })
  @ApiOkResponse({ type: GetUserContributionsResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getContributions(
    @Param('username') username: string,
    @Query() query: GetUserContributionsQueryDTO,
    @Session() session: UserSession | undefined,
  ) {
    return this.users.getContributions(username, query, session?.user?.id);
  }
}
