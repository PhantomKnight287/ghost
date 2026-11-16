# sync.ghost API

Two-way sync between a Ghost repository and a GitHub repository. The design is `docs/superpowers/specs/2026-11-09-sync-ghost-design.md`.

## Run

```sh
bun install
bun run dev
```

The API listens on `SYNC_PORT` (3006 by default) and reads its settings from `apps/sync/api/.env`. Variables Ghost also uses are `SYNC_`-prefixed, so Ghost's root `.env` cannot leak in.

## Tests

```sh
docker run -d --rm --name sync-test-pg -e POSTGRES_PASSWORD=x -p 55434:5432 postgres:17
TEST_DATABASE_URL=postgres://postgres:x@localhost:55434/postgres bun test
```

Without `TEST_DATABASE_URL`, everything that needs Postgres is skipped and only the unit tests run. Never point it at a database you care about: the tests empty their tables.

- `src/**/*.test.ts` test one module each, against in-memory fakes (`src/lib/fake-*.ts`); the store and auth tests also run against Postgres.
- `test/*.test.ts` run the whole API end to end: the real store, durable queue, git mirrors, webhook pipeline and routes, against two fake hosts (`test/fake-host.ts`) that behave like Ghost and GitHub, keep real bare git repositories, and send webhooks for every write, sync.ghost's own included. `settle()` delivers them and drains the queue until both sides are quiet; a sync that keeps echoing fails the test instead of hanging. Each test file gets its own database (`sync_e2e_<file>`), since Bun runs files concurrently.
