import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseFilters,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubAddKeyDTO } from './dto/add-key.dto.js';
import { GithubUsersService } from './users.service.js';

@Controller('v3')
@ApiTags('GitHub compatibility')
@AllowAnonymous()
@UseFilters(GithubRestFilter)
export class UsersController {
  constructor(private readonly users: GithubUsersService) {}

  @Get('user')
  @ApiOperation({ summary: 'The authenticated user, in GitHub REST shape' })
  me(@Viewer() viewer: GithubViewer | null) {
    return this.users.me(viewer);
  }

  @Get('users/:login')
  @ApiOperation({
    summary: 'A user or organization by login, in GitHub REST shape',
  })
  byLogin(@Param('login') login: string) {
    return this.users.byLogin(login);
  }

  @Get('user/keys')
  @ApiOperation({
    summary: "The authenticated user's SSH keys, in GitHub REST shape",
  })
  keys(@Viewer() viewer: GithubViewer | null) {
    return this.users.keys(viewer);
  }

  @Post('user/keys')
  @HttpCode(201)
  @ApiOperation({ summary: 'Add an SSH key to the authenticated user' })
  addKey(@Body() body: GithubAddKeyDTO, @Viewer() viewer: GithubViewer | null) {
    return this.users.addKey(viewer, body);
  }
}
