# 0012 — Materialization is forward-only replay

**Status:** adopted

## Decision

`RepositoryMaterializerService` brings a cached bare repository up to the state
the log describes, before every read and before every push. The cache records
its position in `<repoDirectory>/ghost-wal-seq`.

```
read index → compare to cached seq → index-pack each missing layer in order
           → reconcile refs to the snapshot → repoint HEAD → write cached seq
```

This is what turns [0004](0004-object-storage-is-the-truth.md) from an
intention into an enforced rule. Before it, the read path served whatever
happened to be on local disk and a cold node served an empty repository.

## Why replay is only ever forward

The cache can be behind the log but never ahead of it — that is the ordering
guarantee [0005](0005-single-commit-point.md) buys. So materialization never
needs to undo anything: it applies missing packfiles and moves refs to the
snapshot. There is no rollback path to get wrong.

## Packs from `receive-pack` are thin

A pushed packfile may contain deltas whose base objects the client knew the
server already had, so it omitted them. Replaying such a pack into an empty
object store fails.

Two things make this work:

- **Sequence order is mandatory.** Layer *n*'s bases live in layers before it,
  so replay walks `layers` in index order and never in parallel.
- **`git index-pack --fix-thin --stdin`** completes the pack against the objects
  already present, rather than `unpack-objects`, which cannot.

## Refs are reconciled, not replayed

Entries carry transitions, but materialization applies the index's *snapshot*
via a single `git update-ref --stdin` batch, then deletes any cached ref the
snapshot no longer carries. Replaying transitions one at a time would produce
identical final state at more cost, and would fail on a cache that had drifted.
Reconciling to the snapshot is idempotent from any starting state, which is what
makes a stale or hand-edited cache self-healing.

## HEAD

A bare repository whose `HEAD` names a branch that does not exist clones as
*empty with no error* — one of git's least helpful behaviours. After reconciling,
`ensureHead` repoints `HEAD` at `main`, then `master`, then any branch present.

## The push path deliberately leaves the marker stale

`GitService.receivePack` materializes, commits to the log, then lets
`git receive-pack` apply the push to the cache — but does **not** advance
`ghost-wal-seq`. If another node's push interleaved, the local cache is now a
fork; leaving the marker behind guarantees the next materialize replays over it
and reconciles refs to the log. The cost is one redundant `index-pack` of
objects already present; the benefit is that no interleaving can leave the cache
silently wrong.

## Concurrency

`materialize` collapses concurrent calls for the same repository through an
in-flight promise map, so parallel fetches on one node replay once. Across
nodes there is no coordination and none is needed: replay is idempotent, and
every node converges on the same log.

## Consequences

- A node can serve any repository it has never seen.
- Local disk can be wiped as an operational action.
- `repository-materializer.service.spec.ts` exercises this against real `git`
  binaries and real packfiles with an in-memory store, so push → materialize →
  `git clone` is covered without object storage.
