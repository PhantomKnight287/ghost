# 0018 — Timestamps are `timestamptz`, never bare `timestamp`

**Status:** adopted

## Decision

Every timestamp column in `packages/db/src/schema` uses
`timestamp({ withTimezone: true })`, i.e. Postgres `timestamp with time zone`.
No new `timestamp without time zone` column may be added.

## The problem this exists to solve

`timestamp without time zone` stores a wall-clock reading with no offset, so
its meaning depends on two timezones agreeing: the session that wrote it and
the process that reads it. They stopped agreeing. The database sessions run in
`Europe/Istanbul` while the API process resolved its zone as UTC, so every date
the API returned was shifted +3h: issues "opened in 3 hours", hover cards
showing a future UTC time with a correct-looking local conversion. The data was
never wrong — the same row read correctly from any process sharing the session
zone — which is exactly why it took a three-way comparison (stored wall vs
direct read vs API response) to find it.

`timestamptz` stores an absolute instant. Session zones then only affect
presentation of literals, never the stored value, and the pg driver hands back
the same instant in every process zone. The class of bug disappears instead of
moving.

## Migration

`drizzle-kit generate` emits a bare `SET DATA TYPE timestamp with time zone`,
which reinterprets existing walls in the *migrating* session's zone. That is
implicitly correct only on some machines, so every statement in `0015` carries
an explicit conversion instead:

```sql
ALTER TABLE "issue" ALTER COLUMN "createdAt"
  SET DATA TYPE timestamp with time zone
  USING "createdAt" AT TIME ZONE 'Europe/Istanbul';
```

The zone name is the one the old walls were written in. All existing rows
were written under it, and Istanbul observes no daylight saving, so each wall
names exactly one instant.

## Consequences

- Dates are correct in the API, in direct psql-style reads, and on any future
  server regardless of its system zone.
- Any migration that converts timestamp types must carry an explicit
  `USING ... AT TIME ZONE` clause naming the zone the old walls were written
  in, so the file stays correct when run from another machine.
