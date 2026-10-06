import { sql } from 'drizzle-orm';

/** How long an upload's reservation counts before it is taken for an upload that died with its process. */
export const RESERVATION_TTL = sql`interval '1 day'`;
