import { type Database, schema } from '@ghost/db';
import type { AppPermissions } from '@ghost/permissions';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import {
  InstallationRepositoriesError,
  InstallationSuspendedError,
} from '../../lib/apps/apps.errors.js';
import {
  generateInstallationToken,
  hashInstallationToken,
  INSTALLATION_TOKEN_TTL_MS,
  narrowPermissions,
} from '../../lib/apps/installation-token.js';
import { GithubNotFoundError } from '../../lib/github/github.errors.js';
import { installationCovers } from '../../lib/repositories/access/repository-access.js';
import type {
  AppInstallationCaller,
  GithubApp,
} from '../../github/auth/github-request.js';

export type MintTokenBody = {
  permissions?: Record<string, string>;
  repositories?: string[];
  repository_ids?: number[];
};

/** `ghs_` tokens: minted from an app's JWT for one of its installations, and resolved back to that installation on every request. */
@Injectable()
export class InstallationTokensService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async mint(app: GithubApp, installationId: number, body: MintTokenBody) {
    const [installation] = await this.db
      .select({
        id: schema.appInstallation.id,
        permissions: schema.appInstallation.permissions,
        repositorySelection: schema.appInstallation.repositorySelection,
        suspendedAt: schema.appInstallation.suspendedAt,
      })
      .from(schema.appInstallation)
      .where(
        and(
          eq(schema.appInstallation.numericId, installationId),
          eq(schema.appInstallation.appId, app.appId),
        ),
      );
    if (!installation) throw new GithubNotFoundError();
    if (installation.suspendedAt) throw new InstallationSuspendedError();
    const permissions = narrowPermissions(
      installation.permissions as AppPermissions,
      body.permissions,
    );
    const repositoryIds = await this.repositoriesOf(installation.id, body);

    const { token, hash } = generateInstallationToken();
    const expiresAt = new Date(Date.now() + INSTALLATION_TOKEN_TTL_MS);
    await this.db.insert(schema.appInstallationToken).values({
      installationId: installation.id,
      tokenHash: hash,
      permissions,
      repositoryIds,
      expiresAt,
    });
    return {
      token,
      expiresAt,
      permissions,
      repositorySelection: repositoryIds
        ? ('selected' as const)
        : installation.repositorySelection,
    };
  }

  /** Null for a token that is unknown, expired, of a suspended installation, or of a deleted app. */
  async verify(token: string): Promise<AppInstallationCaller | null> {
    const [caller] = await this.db
      .select({
        installationId: schema.appInstallation.id,
        numericId: schema.appInstallation.numericId,
        appId: schema.app.id,
        botUserId: schema.app.botUserId,
        permissions: schema.appInstallationToken.permissions,
        repositoryIds: schema.appInstallationToken.repositoryIds,
      })
      .from(schema.appInstallationToken)
      .innerJoin(
        schema.appInstallation,
        eq(
          schema.appInstallation.id,
          schema.appInstallationToken.installationId,
        ),
      )
      .innerJoin(schema.app, eq(schema.app.id, schema.appInstallation.appId))
      .where(
        and(
          eq(
            schema.appInstallationToken.tokenHash,
            hashInstallationToken(token),
          ),
          gt(schema.appInstallationToken.expiresAt, new Date()),
          isNull(schema.appInstallation.suspendedAt),
          isNull(schema.app.deletedAt),
        ),
      );
    return caller
      ? { ...caller, permissions: caller.permissions as AppPermissions }
      : null;
  }

  /** The repositories a token is narrowed to by name or id, every one covered by the installation; null when the body narrows nothing. */
  private async repositoriesOf(installationId: string, body: MintTokenBody) {
    const names = body.repositories ?? [];
    const ids = body.repository_ids ?? [];
    if (names.length === 0 && ids.length === 0) return null;
    const covered = await this.db
      .select({ id: schema.repository.id })
      .from(schema.repository)
      .innerJoin(
        schema.appInstallation,
        eq(schema.appInstallation.id, installationId),
      )
      .where(
        and(
          installationCovers(schema.repository),
          or(
            names.length > 0
              ? inArray(schema.repository.slug, names)
              : undefined,
            ids.length > 0
              ? inArray(schema.repository.numericId, ids)
              : undefined,
          ),
        ),
      );
    if (covered.length !== new Set([...names, ...ids]).size)
      throw new InstallationRepositoriesError();
    return covered.map(({ id }) => id);
  }
}
