# 0020 — Deleting a repository is a tombstone, then a purge

**Status:** adopted

## Decision

`DELETE /api/repositories/:username/:slug` removes everything the repository
stored before it answers 204. In order:

1. **Tombstone.** The index is replaced, by compare-and-swap, with an empty one
   whose `deleted` flag is set. From here every read and every push sees the
   repository as absent.
2. **Purge, in parallel.** Every log entry under `repos/<id>/entries/`, the
   local cache directory (after any replay in flight has settled), and the code
   search shards and marker (after any index run in flight has finished).
3. **Drop the row.** Issues, pull requests, stars and every index table cascade.

If any step fails the request fails, the row stays, and the repository is
tombstoned: unreadable, still listed, and deletable again. Every step is
idempotent, so the retry finishes the job.

A repository that heads an open pull request into another repository cannot
be deleted (409). Closed and merged requests it opened are kept: their
`headRepositoryId` is set to null, so the base repository keeps the title,
body, comments and timeline. A merged request still shows its commits and
diff, because the merge copied them into the base (see
[0016](0016-a-pull-request-spans-two-logs.md)). A closed, unmerged one shows
none, since its commits existed only in the deleted repository. A request
opened in the moment between that check and the tombstone is closed in the
same transaction that drops the row, so an open request always has a head.

## Why

Nothing of a repository may outlive the owner's decision to delete it. Postgres
and object storage share no transaction, so "atomic" cannot mean one commit
across both. It means: a 204 is only sent once nothing is left, and anything
short of that is visible to the owner and resumable by them.

The tombstone is what makes the purge safe. A push that raced the delete has
either committed before the tombstone, so its entry is listed and purged, or
loses its compare-and-swap to it, reads the repository as gone, and deletes its
own entry before failing (`PushTransactionService`). Deleting the index instead
would not fence anything: a push authorized a moment earlier would find no
index and create a fresh one under the dead id.

Blocking on open requests protects work in progress in someone else's
repository; keeping closed and merged ones keeps the base repository's history
without keeping any of the deleted repository's code.

## Alternatives rejected

- **Row first, storage later** (the [0010](0010-orphans-are-garbage.md)
  collector). The owner is told the repository is gone while its code is still
  stored, for however long the collector takes.
- **Copying a request's commits into the base on creation**, like GitHub's
  `refs/pull/N/head`. Every diff would survive, but so would the deleted
  repository's code, and it reverses 0016.
- **Storage inside the row's database transaction.** A partial S3 failure rolls
  the row back over a log that has already lost entries: a live, corrupt
  repository instead of a dead, retryable one.

## Consequences

- The tombstone itself is never removed. It holds no refs and no objects, only
  the flag and a sequence number, and it is what stops a late push from
  resurrecting the id.
- A push that crashes between uploading its entry and committing it leaves an
  orphan, but only inside `repos/<id>/entries/`, which the purge empties
  wholesale. With one replica, a crash during a delete takes the delete down
  too, and its retry lists the entries again.
- Pushes rejected for a stale ref or contention now remove their entry too,
  since the same rule applies to data nobody asked to keep.
- The purge covers this process's cache only. The API is pinned to one replica
  in `.railway/railway.ts` for this reason; a second replica needs its caches
  told about deletions.
