import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { DATABASE } from '../../database/database.module.js';
import { isoTimestamp } from '../../lib/db/sql.js';
import {
  findOauthApp,
  keyOauthClientId,
  oauthAppColumns,
} from '../../lib/github/oauth-apps.js';
import { OauthAppNotFoundError } from '../../lib/oauth-apps/oauth-apps.errors.js';
import {
  administeredOrganization,
  membershipIn,
} from '../../lib/organizations/administered-organization.js';
import { oauthAppBlocked } from '../../lib/organizations/oauth-app-access.js';
import type {
  ListOauthAppAccessResponseDTO,
  ListOauthAppOrganizationAccessResponseDTO,
  OauthAppAccessDTO,
} from './dto/oauth-app-access.dto.js';

const requester = alias(schema.user, 'requester');
const decider = alias(schema.user, 'decider');
const ownerUser = alias(schema.user, 'owner_user');
const ownerOrganization = alias(schema.organization, 'owner_organization');

/** An organization's OAuth app access restrictions: which apps its members asked for, and what its admins answered. */
@Injectable()
export class OauthAppAccessService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(
    slug: string,
    userId: string,
  ): Promise<ListOauthAppAccessResponseDTO> {
    const { organizationId, settings } = await administeredOrganization(
      this.db,
      slug,
      userId,
    );
    return {
      restricted: settings?.oauthAppRestrictions ?? false,
      apps: await this.answers(organizationId),
    };
  }

  /** An admin's answer; it stands until it is changed or revoked. */
  async decide(
    slug: string,
    userId: string,
    clientId: string,
    state: 'approved' | 'denied',
  ): Promise<OauthAppAccessDTO> {
    const { organizationId } = await administeredOrganization(
      this.db,
      slug,
      userId,
    );
    if (!(await findOauthApp(this.db, clientId)))
      throw new OauthAppNotFoundError();
    await this.db
      .insert(schema.organizationOauthApp)
      .values({
        organizationId,
        clientId,
        state,
        decidedById: userId,
        decidedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          schema.organizationOauthApp.organizationId,
          schema.organizationOauthApp.clientId,
        ],
        set: { state, decidedById: userId, decidedAt: new Date() },
      });
    const [answer] = await this.answers(organizationId, clientId);
    return answer!;
  }

  /** Forgets the answer, so a revoked approval blocks the app again and a revoked denial lets members ask again. */
  async revoke(slug: string, userId: string, clientId: string) {
    const { organizationId } = await administeredOrganization(
      this.db,
      slug,
      userId,
    );
    await this.db
      .delete(schema.organizationOauthApp)
      .where(
        and(
          eq(schema.organizationOauthApp.organizationId, organizationId),
          eq(schema.organizationOauthApp.clientId, clientId),
        ),
      );
  }

  /** A member asks the admins for the app. Asking again changes nothing: an answer, once given, stands. */
  async request(
    slug: string,
    userId: string,
    clientId: string,
  ): Promise<OauthAppAccessDTO> {
    const { organizationId } = await membershipIn(this.db, slug, userId);
    if (!(await findOauthApp(this.db, clientId)))
      throw new OauthAppNotFoundError();
    await this.db
      .insert(schema.organizationOauthApp)
      .values({
        organizationId,
        clientId,
        state: 'requested',
        requestedById: userId,
      })
      .onConflictDoNothing();
    const [answer] = await this.answers(organizationId, clientId);
    return answer!;
  }

  /** Where the app reaches among the user's organizations, for the approval screen and the authorized apps page. */
  async forApp(
    userId: string,
    clientId: string,
  ): Promise<ListOauthAppOrganizationAccessResponseDTO> {
    if (!(await findOauthApp(this.db, clientId)))
      throw new OauthAppNotFoundError();
    const rows = await this.db
      .select({
        id: schema.organization.id,
        slug: schema.organization.slug,
        name: schema.organization.name,
        restricted: sql<boolean>`coalesce(${schema.organizationSettings.oauthAppRestrictions}, false)`,
        state: schema.organizationOauthApp.state,
      })
      .from(schema.member)
      .innerJoin(
        schema.organization,
        eq(schema.organization.id, schema.member.organizationId),
      )
      .leftJoin(
        schema.organizationSettings,
        eq(schema.organizationSettings.organizationId, schema.organization.id),
      )
      .leftJoin(
        schema.organizationOauthApp,
        and(
          eq(
            schema.organizationOauthApp.organizationId,
            schema.organization.id,
          ),
          eq(schema.organizationOauthApp.clientId, clientId),
        ),
      )
      .where(eq(schema.member.userId, userId))
      .orderBy(schema.organization.slug);
    return {
      organizations: await Promise.all(
        rows.map(async ({ id, ...organization }) => ({
          ...organization,
          allowed: !(await oauthAppBlocked(this.db, {
            clientId,
            organizationId: id,
          })),
        })),
      ),
    };
  }

  private answers(organizationId: string, clientId?: string) {
    const app = schema.organizationOauthApp.clientId;
    return this.db
      .select({
        clientId: app,
        name: oauthAppColumns.name,
        logoUrl: oauthAppColumns.logoUrl,
        description: oauthAppColumns.description,
        homepageUrl: oauthAppColumns.homepageUrl,
        owner: sql<
          string | null
        >`coalesce(${ownerUser.username}, ${ownerOrganization.slug})`,
        // What the app can do here: every scope a member of this organization granted it, through a key or a refresh token still alive.
        scopes: sql<
          string[]
        >`array(select distinct scope from (select jsonb_array_elements_text(coalesce(${schema.apikey.permissions}::jsonb->'scopes', '[]'::jsonb)) as scope from ${schema.apikey} inner join ${schema.member} on ${schema.member.userId} = ${schema.apikey.referenceId} and ${schema.member.organizationId} = ${organizationId} where ${keyOauthClientId} = ${app} union select unnest(${schema.oauthAppRefreshToken.scopes}) from ${schema.oauthAppRefreshToken} inner join ${schema.member} on ${schema.member.userId} = ${schema.oauthAppRefreshToken.userId} and ${schema.member.organizationId} = ${organizationId} where ${schema.oauthAppRefreshToken.clientId} = ${app} and ${schema.oauthAppRefreshToken.expiresAt} > now()) as granted order by scope)`,
        state: schema.organizationOauthApp.state,
        requestedBy: requester.username,
        requestedAt: isoTimestamp(schema.organizationOauthApp.requestedAt),
        decidedBy: decider.username,
        decidedAt: sql<
          string | null
        >`${isoTimestamp(schema.organizationOauthApp.decidedAt)}`,
      })
      .from(schema.organizationOauthApp)
      .innerJoin(
        schema.oauthClient,
        eq(schema.oauthClient.clientId, schema.organizationOauthApp.clientId),
      )
      .leftJoin(ownerUser, eq(ownerUser.id, schema.oauthClient.userId))
      .leftJoin(
        ownerOrganization,
        eq(ownerOrganization.id, schema.oauthClient.referenceId),
      )
      .leftJoin(
        requester,
        eq(requester.id, schema.organizationOauthApp.requestedById),
      )
      .leftJoin(
        decider,
        eq(decider.id, schema.organizationOauthApp.decidedById),
      )
      .where(
        and(
          eq(schema.organizationOauthApp.organizationId, organizationId),
          clientId
            ? eq(schema.organizationOauthApp.clientId, clientId)
            : undefined,
        ),
      )
      .orderBy(desc(schema.organizationOauthApp.requestedAt));
  }
}
