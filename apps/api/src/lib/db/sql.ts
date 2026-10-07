import { type SQL, sql } from 'drizzle-orm';
import { toSnakeCase } from 'drizzle-orm/casing';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

// Timestamps leave the database already in the shape responses promise, so nothing downstream has to convert them. The format matches `Date.prototype.toISOString` byte for byte.
export function isoTimestamp(column: AnyPgColumn | SQL) {
  return sql<string>`to_char(${column} at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

/** The value an upsert tried to insert, for `onConflictDoUpdate`. The database names columns in snake_case, however the schema spells them. */
export function excluded(column: AnyPgColumn) {
  return sql.raw(`excluded."${toSnakeCase(column.name)}"`);
}

// For `ilike`: a search for "50%" or "a_b" matches those characters, not any.
export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
