# 0034 — A push is verified before the log commits it, and the log stores the indexed pack

**Status:** adopted. Amends [0005](0005-single-commit-point.md): the commit point now comes after git's own checks, not before them.

## Decision

`GitService.receivePack` used to commit a push to the log and only then hand it to `git receive-pack`. Every check receive-pack makes therefore ran after the commit point, and a push it refused was already permanent. One crafted request from anyone with write access could make a repository unreadable for good:

```
POST /owner/repo/git-receive-pack     refs/heads/evil -> abab…ab, empty pack
  → receive-pack: "ng refs/heads/evil unpacker error"
  → the log: refs { …, refs/heads/evil: abab…ab }
  → every materialize: update-ref fails, every clone: 500
```

Deleting the ref through git cannot repair it: a delete has to name the ref's current value, and a ref the cache never holds is never advertised.

Now a push passes three checks before `commitPush`:

1. **Names**, at the commit point itself (`PushTransactionService`), so every writer is covered: every new ref passes git's `check-ref-format` rules (`isWellFormedRef`, checked in-process and tested against git), and none sits above or beneath an existing ref (`a` next to `a/b`), checked against the index the CAS replaces. Two concurrent pushes creating `a` and `a/b` each pass any check against a stale view, so this one cannot live anywhere earlier.
2. **Objects**, in `withVerifiedPack`. The pack is indexed with `--fix-thin` into a quarantine directory with the cache lent as an alternate, the way git quarantines a push. Every new ref must name an object the push or the repository holds, and a branch must name a commit.
3. **Reachability**, in the same place. Every object the new refs reach beyond the existing refs must be in the quarantine, looked up there alone.

The third check exists because the cache is not the log. It also holds objects the log never received: the trees `merge-tree` writes on every pull request view, merge commits from merges that failed, test merges a size limit refused. Their names are computable, and a test merge's is deterministic. A ref at one of them passes every check against the cache and fails on the first node that rebuilds from the log.

## The log stores the indexed pack

A thin pack's delta bases come from whatever the receiving side holds. Validated against the cache, they could be objects only the cache holds. The log therefore stores the pack `index-pack --fix-thin` wrote into the quarantine, with every base it borrowed appended, rather than the bytes received. A node replaying the log never needs a base from anywhere else.

The cache still receives the original request through `receive-pack`, which resolves the same bases from the same cache.

## Consequences

- A push git would refuse now gets a 422 naming the ref and the reason, instead of landing and breaking the repository.
- A push is indexed twice: once into the quarantine, once by `receive-pack` into the cache. Moving the quarantine's pack into the cache instead would save the second pass.
- Layers grow by whatever delta bases a thin pack borrowed. Layers written before this decision may still be thin, so replay keeps `--fix-thin` and sequence order.

## Repairing a log broken before this decision

`src/scripts/repair-repositories.ts` (`node dist/scripts/repair-repositories.js [--apply]`, run by hand) checks every repository and, with `--apply`, repairs it. `RepositoryRepairService` does the work:

1. **Replay the log into an empty scratch repository**, never into the cache: the cache can hold objects the log lacks and so hide exactly this damage. An entry that does not index is retried with the local cache lent for delta bases; if that works, a new entry holding the self-contained pack replaces it in place under the old entry's header. Otherwise its layer's size becomes 0, which replay skips. Both keep every layer at its sequence number, so caches stay aligned.
2. **Check every ref.** A ref whose history the scratch repository cannot walk gets the missing objects from the local cache, written back as a new entry. Then a ref is dropped when it is still unwalkable, names a branch at anything but a commit, has a name git refuses, or cannot coexist with another ref; of two that cannot coexist, the one whose entry came later goes.
3. **Commit.** Layer swaps are one compare-and-swap of the index. Dropped refs and rescued objects are one ordinary `commitPush`, so the repair is an entry in the log like any other and moves the sequence forward, which makes every cache reconcile its refs. A push landing first sends the repair back to step 1.

Run it on the API host, where the caches are: elsewhere it finds everything but can rescue nothing.
