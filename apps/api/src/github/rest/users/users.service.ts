import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, sql } from 'drizzle-orm';

import { DATABASE } from '../../../database/database.module.js';
import {
  CouldNotResolveError,
  RequiresAuthenticationError,
} from '../../../lib/github/github.errors.js';
import { githubOrigins } from '../../../lib/github/origins.js';
import { toUserRest } from '../../../lib/github/rest.js';
import type { SshKeyDTO } from '../../../resources/ssh-keys/dto/ssh-key.dto.js';
import { SshKeysService } from '../../../resources/ssh-keys/ssh-keys.service.js';
import type { SshSigningKeyDTO } from '../../../resources/ssh-signing-keys/dto/ssh-signing-key.dto.js';
import { SshSigningKeysService } from '../../../resources/ssh-signing-keys/ssh-signing-keys.service.js';
import { UsersService } from '../../../services/users/users.service.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { requireScope } from '../../auth/require-scopes.js';
import type { GithubAddKeyDTO } from './dto/add-key.dto.js';
import type {
  GithubAuthenticatedUserDTO,
  GithubKeyDTO,
  GithubSigningKeyDTO,
  GithubUserDTO,
} from './dto/user.dto.js';
import { sameName } from '../../../lib/db/sql.js';

/** GitHub's REST users and the authenticated user's SSH authentication and signing keys. */
@Injectable()
export class GithubUsersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UsersService,
    private readonly config: ConfigService,
    private readonly sshKeys: SshKeysService,
    private readonly sshSigningKeys: SshSigningKeysService,
  ) {}

  async me(viewer: GithubViewer | null): Promise<GithubAuthenticatedUserDTO> {
    if (!viewer) throw new RequiresAuthenticationError();
    const user = await this.users.getUserById(viewer.userId);
    return { ...this.restUser(user), email: user.email };
  }

  /** A user, or else an organization, by login. */
  async byLogin(login: string): Promise<GithubUserDTO> {
    const [user] = await this.db
      .select()
      .from(schema.user)
      .where(sameName(schema.user.username, login));
    if (user) return this.restUser(user);
    const [organization] = await this.db
      .select()
      .from(schema.organization)
      .where(sameName(schema.organization.slug, login));
    if (!organization)
      throw new CouldNotResolveError(
        `Could not resolve to a User or Organization with the login of '${login}'.`,
      );
    return {
      ...toUserRest(
        {
          ghostId: organization.id,
          numericId: organization.numericId,
          login: organization.slug,
          avatarUrl: organization.logo,
        },
        githubOrigins(this.config),
        'Organization',
      ),
      name: organization.name,
      created_at: organization.createdAt.toISOString(),
    };
  }

  async keys(viewer: GithubViewer | null) {
    if (!viewer) throw new RequiresAuthenticationError();
    requireScope(viewer, 'GET /user/keys', 'read:public_key');
    const { keys } = await this.sshKeys.list(viewer.userId);
    return keys.map((key) => this.restKey(key));
  }

  async addKey(viewer: GithubViewer | null, body: GithubAddKeyDTO) {
    if (!viewer) throw new RequiresAuthenticationError();
    requireScope(viewer, 'POST /user/keys', 'write:public_key');
    return this.restKey(
      await this.sshKeys.add(
        viewer.userId,
        body.key,
        body.title,
        viewer.oauthClientId,
      ),
    );
  }

  async signingKeys(viewer: GithubViewer | null) {
    if (!viewer) throw new RequiresAuthenticationError();
    requireScope(viewer, 'GET /user/ssh_signing_keys', 'read:ssh_signing_key');
    const { keys } = await this.sshSigningKeys.list(viewer.userId);
    return keys.map((key) => this.restSigningKey(key));
  }

  async signingKey(viewer: GithubViewer | null, id: number) {
    if (!viewer) throw new RequiresAuthenticationError();
    requireScope(
      viewer,
      'GET /user/ssh_signing_keys/{id}',
      'read:ssh_signing_key',
    );
    return this.restSigningKey(
      await this.sshSigningKeys.findByNumericId(viewer.userId, id),
    );
  }

  async addSigningKey(viewer: GithubViewer | null, body: GithubAddKeyDTO) {
    if (!viewer) throw new RequiresAuthenticationError();
    requireScope(
      viewer,
      'POST /user/ssh_signing_keys',
      'write:ssh_signing_key',
    );
    return this.restSigningKey(
      await this.sshSigningKeys.add(viewer.userId, body.key, body.title),
    );
  }

  async removeSigningKey(viewer: GithubViewer | null, id: number) {
    if (!viewer) throw new RequiresAuthenticationError();
    requireScope(
      viewer,
      'DELETE /user/ssh_signing_keys/{id}',
      'admin:ssh_signing_key',
    );
    await this.sshSigningKeys.remove(viewer.userId, { numericId: id });
  }

  private restSigningKey(
    key: SshSigningKeyDTO & { numericId: number },
  ): GithubSigningKeyDTO {
    return {
      id: key.numericId,
      key: key.publicKey,
      title: key.title,
      created_at: key.createdAt,
    };
  }

  private restKey(key: SshKeyDTO): GithubKeyDTO {
    return {
      id: null,
      key: key.publicKey,
      title: key.title,
      created_at: key.createdAt,
      read_only: false,
      verified: true,
    };
  }

  private restUser(user: typeof schema.user.$inferSelect): GithubUserDTO {
    return {
      ...toUserRest(
        {
          ghostId: user.id,
          numericId: user.numericId,
          login: user.username ?? '',
          avatarUrl: user.image,
        },
        githubOrigins(this.config),
      ),
      name: user.name,
      created_at: user.createdAt.toISOString(),
      updated_at: user.updatedAt.toISOString(),
    };
  }
}
