import { type Database, schema } from '@ghost/db';
import { eq } from 'drizzle-orm';

import { organizationMembership } from '../git/repository-access/repository-access.js';
import { administers, organizationRoleOf } from '@ghost/permissions';
import {
  OrganizationForbiddenError,
  OrganizationNotFoundError,
} from './organization.errors.js';

type Visibility = (typeof schema.repositoryVisiblity.enumValues)[number];

/** The requester's standing in the organization behind `slug`, with its policies. Outsiders get a 404, the way repositories answer. */
export async function membershipIn(
  db: Pick<Database, 'select'>,
  slug: string,
  userId: string,
) {
  const [membership] = await db
    .select({
      organizationId: schema.organization.id,
      memberRole: schema.member.role,
      settings: schema.organizationSettings,
    })
    .from(schema.organization)
    .leftJoin(
      schema.member,
      organizationMembership(schema.organization.id, { userId }),
    )
    .leftJoin(
      schema.organizationSettings,
      eq(schema.organizationSettings.organizationId, schema.organization.id),
    )
    .where(eq(schema.organization.slug, slug));

  if (!membership?.memberRole) throw new OrganizationNotFoundError(slug);
  return { ...membership, role: organizationRoleOf(membership.memberRole) };
}

/** The organization behind `slug`, if `userId` administers it; members below admin get a 403. */
export async function administeredOrganization(
  db: Pick<Database, 'select'>,
  slug: string,
  userId: string,
) {
  const { organizationId, role, settings } = await membershipIn(
    db,
    slug,
    userId,
  );
  if (!administers(role)) {
    throw new OrganizationForbiddenError();
  }
  return { organizationId, settings };
}

/** Where `userId` may create a repository of `visibility` in the organization: always for its admins, and for members as far as its policy allows. */
export async function organizationToCreateIn(
  db: Pick<Database, 'select'>,
  slug: string,
  userId: string,
  visibility: Visibility,
) {
  const { organizationId, role, settings } = await membershipIn(
    db,
    slug,
    userId,
  );
  const allowed =
    administers(role) ||
    (role === 'member' &&
      (visibility === 'public'
        ? settings?.membersCanCreatePublicRepositories
        : settings?.membersCanCreatePrivateRepositories));
  if (!allowed) throw new OrganizationForbiddenError();
  return { organizationId, settings };
}
