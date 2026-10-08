import { HttpStatus } from '@nestjs/common';
import { and, asc, desc, eq, gt, lt, or, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { DomainError } from '../../domain/errors.js';

export class InvalidCursorError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor() {
    super(`Invalid pagination cursor`);
  }
}

type KeyValue = Date | number | string;

/** Keyset pagination over `keys`, compared left to right; each key is named for the row field its value is read from. The cursor is base64url so callers treat it as a token, not something to hand-build. */
export function keyset<Keys extends Record<string, AnyPgColumn>>({
  cursor,
  limit,
  keys,
  direction = 'desc',
}: {
  cursor: string | undefined;
  limit: number;
  keys: Keys;
  direction?: 'asc' | 'desc';
}) {
  const names = Object.keys(keys);
  const columns = Object.values(keys);
  const order = direction === 'asc' ? asc : desc;
  const past = direction === 'asc' ? gt : lt;
  const values = cursor ? decode(cursor, columns) : undefined;

  return {
    where: values
      ? columns.reduceRight<SQL | undefined>(
          (tie, column, i) =>
            tie
              ? or(past(column, values[i]), and(eq(column, values[i]), tie))
              : past(column, values[i]),
          undefined,
        )
      : undefined,
    orderBy: columns.map((column) => order(column)),
    // One row past the page says whether another page follows.
    limit: limit + 1,
    page<Row extends Record<keyof Keys, unknown>>(rows: Row[]) {
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page.at(-1);
      return {
        page,
        hasMore,
        nextCursor:
          hasMore && last ? encode(names.map((name) => last[name])) : null,
      };
    },
  };
}

function encode(values: unknown[]) {
  return Buffer.from(
    values
      .map((value) =>
        value instanceof Date ? value.toISOString() : String(value),
      )
      .join('|'),
  ).toString('base64url');
}

function decode(cursor: string, columns: AnyPgColumn[]): KeyValue[] {
  const parts = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (parts.length !== columns.length) throw new InvalidCursorError();
  return parts.map((part, i) => {
    const type = columns[i]!.dataType;
    const value =
      type === 'date'
        ? new Date(part)
        : type === 'number'
          ? Number(part)
          : part;
    if (!part || (typeof value !== 'string' && !Number.isFinite(+value)))
      throw new InvalidCursorError();
    return value;
  });
}
