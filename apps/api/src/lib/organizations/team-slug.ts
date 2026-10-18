import { schema } from '@ghost/db';
import { eq } from 'drizzle-orm';
import slugify from 'slugify';

import type { Executor } from '../db/executor.js';

/** A team's name as it appears in URLs and `@org/team` mentions. Teams have no stored slug, so renaming a team moves its URL. */
export function teamSlug(name: string) {
  return slugify(name, { lower: true, strict: true });
}

/** An organization's teams with their slugs, the one way to find a team by slug since none is stored. Slugs are lowercase, so compare a lowercased one: GitHub matches them without regard to case. */
export async function organizationTeams(db: Executor, organizationId: string) {
  const teams = await db
    .select({ id: schema.team.id, name: schema.team.name })
    .from(schema.team)
    .where(eq(schema.team.organizationId, organizationId));
  return teams.map((team) => ({ ...team, slug: teamSlug(team.name) }));
}
