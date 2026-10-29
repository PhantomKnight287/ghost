import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, sql } from 'drizzle-orm';

import { DATABASE } from '../../../database/database.module.js';
import { AppJwtError } from '../../../lib/apps/apps.errors.js';
import { isoTimestamp } from '../../../lib/db/sql.js';
import { encodeNodeId } from '../../../lib/github/node-id.js';
import { githubOrigins } from '../../../lib/github/origins.js';
import { toUserRest } from '../../../lib/github/rest.js';
import type { GithubApp } from '../../auth/github-request.js';
import type { GithubAppDTO } from './dto/app.dto.js';

@Injectable()
export class GithubAppService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: ConfigService,
  ) {}

  /** The app the JWT authenticated. Any other caller gets GitHub's answer to a token that is not an app JWT. */
  async authenticated(app: GithubApp | null): Promise<GithubAppDTO> {
    if (!app) throw new AppJwtError();
    const origins = githubOrigins(this.config);
    const [row] = await this.db
      .select({
        ghostId: schema.app.id,
        id: schema.app.numericId,
        slug: schema.app.slug,
        name: schema.app.name,
        description: schema.app.description,
        external_url: schema.app.homepageUrl,
        created_at: isoTimestamp(schema.app.createdAt),
        updated_at: isoTimestamp(schema.app.updatedAt),
        permissions: sql<
          GithubAppDTO['permissions']
        >`jsonb_build_object('metadata', 'read') || ${schema.app.permissions}`,
        events: schema.app.events,
        installationsCount: sql<number>`(select count(*)::int from ${schema.appInstallation} where ${schema.appInstallation.appId} = ${schema.app.id})`,
        owner: {
          ghostId: sql<string>`coalesce(${schema.organization.id}, ${schema.user.id})`,
          numericId: sql<number>`coalesce(${schema.organization.numericId}, ${schema.user.numericId})`,
          login: sql<string>`coalesce(${schema.organization.slug}, ${schema.user.username})`,
          avatarUrl: sql<
            string | null
          >`coalesce(${schema.organization.logo}, ${schema.user.image})`,
          isOrganization: sql<boolean>`${schema.organization.id} is not null`,
        },
      })
      .from(schema.app)
      .leftJoin(schema.user, eq(schema.user.id, schema.app.ownerUserId))
      .leftJoin(
        schema.organization,
        eq(schema.organization.id, schema.app.ownerOrganizationId),
      )
      .where(eq(schema.app.id, app.appId));
    if (!row) throw new AppJwtError();
    const { ghostId, owner, installationsCount: _, ...fields } = row;
    return {
      ...fields,
      node_id: encodeNodeId('App', ghostId),
      owner: toUserRest(
        owner,
        origins,
        owner.isOrganization ? 'Organization' : 'User',
      ),
      html_url: `${origins.web}/apps/${row.slug}`,
      installations_count: row.installationsCount,
    };
  }
}
