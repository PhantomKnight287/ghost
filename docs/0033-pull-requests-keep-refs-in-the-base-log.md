# 0033 — Pull requests keep `refs/pull/<n>/head` and `/merge` in the base log

**Status:** adopted. Supersedes the "no `refs/pull/*`" part of [0016](0016-a-pull-request-spans-two-logs.md); its read and merge paths are unchanged.

## Decision

Every pull request has two refs in its base repository's log, named the way GitHub, Gitea and Forgejo name them, so `git fetch origin pull/42/head` and CI recipes written for those hosts work unchanged:

| Ref | Holds |
| --- | --- |
| `refs/pull/<n>/head` | The head branch's tip, with every object it needs copied into the base log |
| `refs/pull/<n>/merge` | A test merge of that tip into the base branch's tip, absent while the two conflict |

`PullRefsService.sync` reads both tips, builds the test merge with `merge-tree` in the base cache with the head lent as an alternate (0016), packs everything the base log does not already name, and commits it with `commitPush` like any push. The pack excludes every ref tip the base log holds, the old pull refs included, so each update carries only what the head added since the last one.

The test merge is dated by its later parent, not the clock, and signed `Ghost <noreply@ghost.local>` with the message `Merge <head> into <base>`. Rebuilding it for an unchanged pair yields the same commit, so a sync with nothing new writes nothing.

## When a sync runs

After the change that made the refs stale, never inside it, and coalesced per request: a sync asked for while one runs becomes a single rerun.

- a push over HTTP or SSH moves a branch that heads or bases an open request;
- a request is opened;
- a suggestion is committed to a head branch;
- a request merges: its head is pinned to what merged, and every other open request into the same base gets a new test merge.

Reading a request reconciles too. `openLive` already resolves both tips; if the head ref or the merge ref's parents disagree with them, a sync starts. A sync lost to a crash therefore lasts until the next read or push, never forever. `src/scripts/backfill-pull-refs.ts` writes the refs for requests opened before this decision.

The outbox (0029) was not used: it carries events to people and endpoints outside the API, and this is the API maintaining its own state.

A sync that loses the log's compare-and-swap to a concurrent push re-reads and retries, three times at most. Two API instances syncing the same request both aim at the tips as they stand, so the loser finds nothing left to do.

## What a client may push

Nothing under `refs/pull/`. `GitService.receivePack` refuses it before the log, because receive-pack's own refusals land after the commit point (0005), too late to keep a ref out. The one exception is the key minted for a running import (0032), which carries GitHub's `refs/pull/*/head` over.

A fork's log is copied without `refs/pull/*`: those refs belong to the repository the requests were opened against.

## Protocol v2

Ghost passes an exact `Git-Protocol: version=2` header, or an SSH `GIT_PROTOCOL=version=2` environment request, through to `upload-pack`. On v0 every fetch receives every ref first, and a repository with thousands of pull requests would send all of them before each `git pull`; v2's `ls-refs` sends only the prefixes the client asks for. Any other value keeps git on v0, so nothing a client sends reaches git's environment verbatim.

## Storage

Each sync's pack size is recorded in `pull_request_ref_write`. Before committing the log entry, the sync durably records its preallocated entry ID in `pull_request_ref_write_pending`, outside the quota transaction. Later syncs reconcile pending IDs against the base log's committed layers before any early return, and reads trigger this reconciliation even when the refs match. Recovery inserts the size with an entry-derived accounting ID, so retrying an ambiguous database commit cannot charge twice. Entries absent from the index stay pending because another writer may still commit them; definite log rejections remove their intents. A crash before committing can leave an uncharged intent. Any future log compaction must preserve pending entries until their accounting is recovered.

- While a request is unmerged, open or closed, its bytes are billed to nobody.
- Once it merges, they count against the base repository's account in `StorageQuotaService.usageOf`.
- `PULL_REF_MAX_BYTES` caps one sync; `PULL_REF_UNMERGED_MAX_BYTES` caps what one author's unmerged requests may hold altogether, checked under a per-author advisory lock. Both are unset by default. A sync refused by either leaves the refs where they were and stores the reason in `pull_request.pull_refs_blocked`, which the request page shows; the next sync that finds the refs current clears it.

A merge excludes the pull head ref when it packs, so the head's objects, already written by the last sync, are not stored twice.

## `/merge`

Kept current eagerly, which is the cost: a push to a base branch rebuilds the test merge of every open request into it, and each rebuild with a new parent writes an entry and leaves the previous merge commit unreachable. Computing it lazily, as GitHub does, needs the fetch itself to trigger the work, and the advertisement is plain `upload-pack` output.

## Consequences

- Nothing pushed to a pull request can be removed from the base repository: not by a force push, by closing it, or by deleting the fork. Users are told so; deleting the base repository (0020) is the only purge.
- The base log grows by one layer per sync. Checkpoints (0011) bound the replay cost; reclaiming unreachable test merges and force-pushed heads needs compaction with reachability, which does not exist yet.
- A closed request keeps its refs where they last pointed. A merged one keeps its last test merge.
- The refs trail the push that moved them by however long a sync takes.
- A request that conflicts has no merge ref, so every read of it reruns a `merge-tree` that writes nothing.
