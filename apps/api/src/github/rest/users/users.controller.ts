import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseFilters } from '@nestjs/common';
import { type Database, schema } from '@ghost/db';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../../../database/database.module.js';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { GithubRestFilter } from '../github-rest.filter.js';
import { UsersService } from '../../../services/users/users.service.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { CouldNotResolveError, RequiresAuthenticationError } from '../../../lib/github/github.errors.js';
import { githubOrigins } from '../../../lib/github/origins.js';
import { encodeNodeId } from '../../../lib/github/node-id.js';
import { SshKeysService } from '../../../resources/ssh-keys/ssh-keys.service.js';
import type { SshKeyDTO } from '../../../resources/ssh-keys/dto/ssh-key.dto.js';
import { GithubAddKeyDTO } from './dto/add-key.dto.js';

@Controller('v3')
@ApiTags('GitHub compatibility')
@AllowAnonymous()
@UseFilters(GithubRestFilter)
export class UsersController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UsersService,
    private readonly config: ConfigService,
    private readonly sshKeys: SshKeysService,
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

  @Get('user/keys')
  @ApiOperation({ summary: "The authenticated user's SSH keys, in GitHub REST shape" })
  async keys(@Viewer() viewer: GithubViewer | null) {
    if (!viewer) throw new RequiresAuthenticationError();
    const { keys } = await this.sshKeys.list(viewer.userId);
    return keys.map((key) => this.restKey(key));
  }

  @Post('user/keys')
  @HttpCode(201)
  @ApiOperation({ summary: 'Add an SSH key to the authenticated user' })
  async addKey(@Body() body: GithubAddKeyDTO, @Viewer() viewer: GithubViewer | null) {
    if (!viewer) throw new RequiresAuthenticationError();
    return this.restKey(await this.sshKeys.add(viewer.userId, body.key, body.title));
  }

  private restKey(key: SshKeyDTO) {
    return { id: null, key: key.publicKey, title: key.title, created_at: key.createdAt, read_only: false, verified: true };
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
