# 0032 — GitHub imports run outside the API, which owns the retries

**Status:** adopted

## Decision

Importing a GitHub repository is done by `apps/importer`, a separate Bun service. The API decides when an import runs and whether it is retried; the importer only does the work.

1. **Start, in the API.** `POST /imports` checks that the user's linked GitHub account can read the source, creates the repository, and inserts a `repository_import` row.
2. **Dispatch, in the API.** `ImportDispatcherService` claims due rows with `FOR UPDATE SKIP LOCKED`, stamps a fresh `claim_token`, mints a Ghost API key for the requester that lives a day at most, and posts the job to the importer. It polls only while an import is unfinished.
3. **Work, in the importer.** It fetches branches, tags and `refs/pull/*/head` from GitHub, pushes them to Ghost over smart HTTP with the API key, then sends releases, issues with their pull requests, and comments to `/api/internal/imports/:id/*` in batches, and finally reports the outcome.

Every importer callback carries the attempt's `claim_token` and renews a two-minute lease; the importer also sends a heartbeat every 30 seconds. The API retries with exponential backoff and full jitter, up to six attempts, when the importer refuses a job, reports a retryable failure, or lets its lease lapse. A callback for any attempt but the current one gets 409 and the importer stops. A new attempt revokes the previous attempt's key.

Imported rows are authored by `ghost-importer`, a user seeded by migration whose username contains a hyphen, which Better Auth's username validator refuses, so no person can claim the name. The GitHub author is credited at the top of each body. Issue and pull request numbers are kept, so `#123` in imported text still resolves. Writes are upserts keyed by tag name and issue number, so a retried attempt overwrites rather than duplicates; opening an issue or pull request is refused while an import is unfinished, since the import owns those numbers.

## Why

A large repository takes minutes to clone and push. Doing that inside the API would hold its memory, disk and event loop, and a deploy would kill the work silently. A separate service can be scaled, limited and restarted on its own.

The push goes through the same HTTP path as any user's push, so the write-ahead log, code search indexing and contribution counts behave exactly as they would for a push from a laptop. That needs a credential, hence the short-lived API key.

Domain writes stay in the API, which already owns issue numbering, comment counts and the pull request invariants; the importer never touches the database.

Rejected:

- **The importer claims jobs from Postgres itself**, as `apps/delivery` does. The API would then need no dispatcher, but the importer would need database access and its own copy of the claim logic, and the retry policy would live in a second place.
- **Calling `GitService.receivePack` in process** to skip the key. It ties the clone's lifetime to an API process.
- **A dedicated bot user named `ghost`.** The name is one a person may want, and GitHub already uses it for deleted accounts.

## Consequences

- Imports are optional: without `IMPORTER_URL`, `IMPORTER_SECRET`, `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` the API reports them disabled.
- The API key gives the importer the requester's full access until the attempt ends or the key expires. Deleting the repository mid-import leaves the key to expire on its own.
- `refs/pull/*` refs are pushed and so are advertised to clones, as on GitHub.
- A user pushing to the repository during an import can make the import's non-forced push fail; that attempt is retried and fails for good if the conflict stays.
- Not imported: release assets, LFS objects, line comments on pull requests, reactions, assignees and milestones.
