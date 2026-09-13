import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { OptionalAuth } from '@thallesp/nestjs-better-auth';

import { ErrorResponseDTO } from '../../domain/http.js';
import { UserProfileResponseDTO } from './dto/profile.dto.js';
import { UserService } from './user.service.js';

@Controller('users')
@ApiTags('Users')
export class UserController {
  constructor(private readonly users: UserService) {}

  @Get(':username')
  @OptionalAuth()
  @ApiOperation({ summary: "Read a user's public profile" })
  @ApiOkResponse({ type: UserProfileResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getProfile(@Param('username') username: string) {
    return this.users.getProfile(username);
  }
}
