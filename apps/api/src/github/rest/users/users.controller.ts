import { Controller, Get, Inject, Param, UseFilters } from '@nestjs/common';
import { type Database, schema } from '@ghost/db';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../../../database/database.module.js';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { GithubRestFilter } from '../github-rest.filter.js';
import { UsersService } from '../../../services/users/users.service.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { GithubViewer } from '../../auth/github-request.js';
import { CouldNotResolveError, RequiresAuthenticationError } from '../../../lib/github/github.errors.js';
import { githubOrigins } from '../../../lib/github/origins.js';
import { encodeNodeId } from '../../../lib/github/node-id.js';

@Controller('v3')
@ApiTags('GitHub compatibility')
@AllowAnonymous()
@UseFilters(GithubRestFilter)
export class UsersController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  @Get('user')
  @ApiOperation({ summary: 'The authenticated user, in GitHub REST shape' })
  async me(@Viewer() viewer: GithubViewer | null) {
    if (!viewer) throw new RequiresAuthenticationError();
    const user = await this.users.getUserById(viewer.userId);
    return { ...this.restUser(user), email: user.email };
  }

  @Get('users/:login')
  @ApiOperation({ summary: 'A user or organization by login, in GitHub REST shape' })
  async byLogin(@Param('login') login: string) {
    const [user] = await this.db.select().from(schema.user).where(eq(schema.user.username, login));
    if (user) return this.restUser(user);
    const [organization] = await this.db.select().from(schema.organization).where(eq(schema.organization.slug, login));
    if (!organization) throw new CouldNotResolveError(`Could not resolve to a User or Organization with the login of '${login}'.`);
    const { api, web } = githubOrigins(this.config);
    return {
      login: organization.slug,
      id: null,
      node_id: encodeNodeId('Organization', organization.id),
      avatar_url: organization.logo ?? '',
      url: `${api}/api/v3/users/${organization.slug}`,
      html_url: `${web}/${organization.slug}`,
      type: 'Organization',
      site_admin: false,
      name: organization.name,
      created_at: organization.createdAt.toISOString(),
    };
  }

  private restUser(user: typeof schema.user.$inferSelect) {
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
      created_at: user.createdAt.toISOString(),
      updated_at: user.updatedAt.toISOString(),
    };
  }
}
