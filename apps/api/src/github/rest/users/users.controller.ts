import { Controller, Get, UseFilters } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { GithubRestFilter } from '../github-rest.filter.js';
import { UsersService } from '../../../services/users/users.service.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { GithubViewer } from '../../auth/github-request.js';
import { RequiresAuthenticationError } from '../../../lib/github/github.errors.js';
import { githubOrigins } from '../../../lib/github/origins.js';
import { encodeNodeId } from '../../../lib/github/node-id.js';

@Controller('v3')
@ApiTags('GitHub compatibility')
@AllowAnonymous()
@UseFilters(GithubRestFilter)
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  @Get('user')
  @ApiOperation({ summary: 'The authenticated user, in GitHub REST shape' })
  async me(@Viewer() viewer: GithubViewer | null) {
    if (!viewer) throw new RequiresAuthenticationError();
    const user = await this.users.getUserById(viewer.userId);
    const { api, web } = githubOrigins(this.config);
    return {
      login: user.username,
      id: null,
      node_id: encodeNodeId('User', user.id),
      avatar_url: user.image ?? '',
      url: `${api}/api/v3/users/${user.username}`,
      html_url: `${web}/${user.username}`,
      type: 'User',
      site_admin: false,
      name: user.name,
      email: user.email,
      created_at: user.createdAt.toISOString(),
      updated_at: user.updatedAt.toISOString(),
    };
  }
}
