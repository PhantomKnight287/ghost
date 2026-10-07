import { HttpStatus } from '@nestjs/common';
import { and, eq, lt, or, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

import { DomainError } from '../../domain/errors.js';

export class InvalidCursorError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor() {
    super(`Invalid pagination cursor`);
  }
}

// Opaque keyset cursor: a (timestamp, id) pair, base64url encoded so callers treat it as a token instead of something they can hand-build.
export function encodeCursor({ date, id }: { date: Date; id: string }) {
  return Buffer.from(`${date.toISOString()}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string) {
  const [timestamp, id] = Buffer.from(cursor, 'base64url')
    .toString('utf8')
    .split('|');
  if (!timestamp || !id) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return { date, id };
}

/** The rows after `cursor` in a list ordered by (date, id) descending; nothing to filter on the first page. */
export function keysetAfter(
  cursor: string | undefined,
  dateColumn: PgColumn,
  idColumn: PgColumn,
): SQL | undefined {
  if (!cursor) return undefined;
  const decoded = decodeCursor(cursor);
  if (!decoded) throw new InvalidCursorError();
  return or(
    lt(dateColumn, decoded.date),
    and(eq(dateColumn, decoded.date), lt(idColumn, decoded.id)),
  );
}

/** Splits `pageSize + 1` fetched rows into the page and the cursor that continues after it. */
export function paginate<T>(
  rows: T[],
  pageSize: number,
  cursorOf: (row: T) => string,
) {
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const last = page.at(-1);
  return { page, hasMore, nextCursor: hasMore && last ? cursorOf(last) : null };
}
