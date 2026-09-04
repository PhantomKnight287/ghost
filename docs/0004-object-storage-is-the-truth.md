# 0004 — Object storage is the source of truth, local disk is a cache

**Status:** adopted

## Decision

Every repository's authoritative state lives in S3 as a write-ahead log. The
bare repositories on disk are a **cache keyed by `(repoId, seq)`** and may be
deleted at any time without data loss.

```
repos/<repoId>/index                  the only mutable object
repos/<repoId>/entries/<ulid>.pack    immutable: header + packfile bytes
```

## Why

Holding every repository on local disk does not survive a crash, does not
survive a node being replaced, and does not scale past one machine. A node that
has never seen a repository must be able to serve it, and a node that dies
mid-push must not leave the repository in a state no other node can interpret.

The log makes that possible: any node can reconstruct any repository at any
point in its history by replaying entries in the order the index records.

## The rule that keeps it honest

The instant local disk becomes authoritative for anything, there is split brain
across nodes. So:

- A push commits to the log **before** the local repository is touched
  (`GitService.receivePack`).
- Serving a fetch materializes forward from the log when the local cache's
  recorded seq is behind the index.
- A crash between the commit and the local write leaves the cache *behind* the
  log, which the next materialization repairs.

Reversing those two steps is unrecoverable: a failed commit would leave a
locally visible ref for a push that never happened.

## Consequences

- `RepositoryStorageService` currently writes to `os.tmpdir()` and auto-creates
  any repository anyone names. That is a prototype stand-in and is why pushing
  to a non-existent repository silently succeeds instead of returning 404.
  See [0011](0011-deferred.md).
- Local disk can be wiped as an operational action, not an incident.
