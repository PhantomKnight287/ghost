import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UseFilters,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { SignInOptional } from '../../../auth/api-key-auth.guard.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubAddKeyDTO } from './dto/add-key.dto.js';
import { GithubUsersService } from './users.service.js';
import { TransformToLowercasePipe } from '../../../pipes/transform-to-lowercase/transform-to-lowercase.pipe.js';

const ID = new ParseIntPipe({ errorHttpStatusCode: 404 });

@Controller('v3')
@ApiTags('GitHub compatibility')
@SignInOptional()
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
  byLogin(@Param('login', TransformToLowercasePipe) login: string) {
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

  @Get('user/ssh_signing_keys')
  @ApiOperation({
    summary: "The authenticated user's SSH signing keys, in GitHub REST shape",
  })
  signingKeys(@Viewer() viewer: GithubViewer | null) {
    return this.users.signingKeys(viewer);
  }

  @Get('user/ssh_signing_keys/:id')
  @ApiOperation({ summary: 'One SSH signing key of the authenticated user' })
  signingKey(
    @Param('id', ID) id: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.users.signingKey(viewer, id);
  }

  @Post('user/ssh_signing_keys')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Add an SSH signing key to the authenticated user',
  })
  addSigningKey(
    @Body() body: GithubAddKeyDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.users.addSigningKey(viewer, body);
  }

  @Delete('user/ssh_signing_keys/:id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove an SSH signing key from the authenticated user',
  })
  removeSigningKey(
    @Param('id', ID) id: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.users.removeSigningKey(viewer, id);
  }
}
