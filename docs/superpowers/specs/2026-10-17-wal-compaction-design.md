# WAL compaction: checkpoints, then trimming

**Status:** deferred. A performance fix, parked behind a persistent cache volume. Ghost [#23](https://web.ghost.procrastinator.fyi/ghost/ghost/issues/23); settles "Checkpoints and compaction" in [0011](../../0011-deferred.md) when built.

## Why

Ghost runs on ephemeral nodes. The API sleeps when idle (`sleepApplication: true` in `.railway/railway.ts`), and its repository caches live in `os.tmpdir()/ghost` (`repository-storage.service.ts`). Every wake and every deploy therefore starts with an empty cache, and the first request for a repository replays its whole log ([0012](../../0012-forward-only-materialization.md)), one layer at a time. Each layer costs two round trips to the store and one `git index-pack --fix-thin`, whatever its size.

Warm requests are unaffected. They read the index, find the cache current, and answer in the same time for a large repository as for a small one: 0.3 to 0.7 s from outside, mostly network, for commits, trees, pull requests and `info/refs` on both `ghost/ghost` and `ghost/.ghost`.

### Interim fix

A Railway volume mounted at `/tmp/ghost` keeps caches across sleeps and deploys. The API image runs as root without `TMPDIR`, so `os.tmpdir()/ghost` is that path and no code changes. This works against Ghost's premise that a node owns no state, and it costs money, so it is a stopgap until compaction lands.

## Findings

### Production, 2026-10-17

The replay log (commit `2816b23`) on a cold open of `ghost/ghost`:

```
Materialized repo_r05a55o9nb5hllemou9zpv29 from seq 0 to 135 in 11342ms:
index read 94ms, 134 layers opened in 6335ms and indexed in 4831ms
```

About 83 ms per layer: 47 ms to open it (two store requests) and 36 ms to stream and index it. Neither bandwidth nor `index-pack` CPU dominates: the cost is fixed per layer.

### The `ghost/ghost` index

Decoded from the production index object (13,967 bytes) with `decodeIndex`:

| | |
|---|---|
| seq | 135, `compactedThroughSeq` 0 |
| Layers | 135, one empty |
| Layer bytes | 23.9 MB in total |
| Layer sizes | median 13.8 KB, 90th percentile 303 KB, largest 8.5 MB; 59 under 10 KB, several 217 to 499 bytes |
| Refs | 128: 89 branches, 36 `refs/pull/*`, 3 tags |
| Growth | 4 layers a day over 34 days; 11 to 18 a day in the week to 2026-10-17 |

Pull ref writes ([0033](../../0033-pull-requests-keep-refs-in-the-base-log.md)) add a layer each, which is why layers outnumber pushes and most are tiny. At last week's rate a cold open gained 1 to 1.5 s a day.

Keep a copy of this index as a test fixture when the work starts: it is the best guard that existing version 1 indexes keep decoding.

### Local replay of the same repository

`ghost/ghost` cloned from production repacks into one 15.9 MB pack with a 355 KB `.idx`, 12,645 objects and 630 commits. Splitting `main` into 30 incremental packs and replaying them on a laptop:

| Replay | Time |
|---|---|
| 30 × `index-pack --fix-thin --stdin` | 0.8 to 0.9 s |
| 1 × `index-pack` of the repacked pack | 0.35 to 0.4 s |
| Copying the pack and `.idx` into `objects/pack` | 0.11 to 0.13 s |

Even on a slower CPU the index-packs explain only part of production's time; the rest is per-layer round trips.

### Expected result

A cold open after compaction costs one index read (~0.1 s), one parallel fetch of the checkpoint pack and `.idx` (~0.3 to 0.5 s for 16 MB in-region), placing the files, refs and HEAD (~0.1 s), and about 83 ms for each layer since the checkpoint. That is about 0.5 s right after compaction and about 2 s with up to 20 layers since, against 11 s and rising. Cold-open time then follows repository size and recent layers, not the length of history.

## Design

Three steps, each shipped and run on real traffic before the next. Only the last cannot be undone.

| Step | What | Reversible | Saves |
|---|---|---|---|
| A | Checkpoints; every layer kept | yes | cold-open time |
| B | Trim the index; billing moves to checkpoints | yes, from kept entries | index size and per-layer metadata |
| C | Delete trimmed entries after a day | **no** | storage |

### Step A: checkpoints

A **checkpoint** is one pack holding every object of layers 1 to N, with its `.idx`, at `repos/<repoId>/checkpoints/<N>.pack` and `.idx`. The index names the newest one. A node whose cache is behind it downloads the pack and `.idx` straight into `objects/pack`, without `index-pack`, then replays only the layers after N.

**The index keeps every layer.** Compaction adds a checkpoint and removes nothing; `compactedThroughSeq` stays 0. Five readers depend on the full layer list and keep working unchanged:

- pull ref accounting (`pull-refs.service.ts`) treats a pending write whose layer has left the index as abandoned, and drops its billing;
- the storage backfill (`repository-log-backfill.service.ts`) bills from the layer list;
- a fork (`repositories.service.ts`) bills its size from the layer list and copies every layer;
- a push retrying a lost compare-and-swap (`push-transaction.service.ts`) looks for its own layer to learn it already committed;
- repair (`repository-repair.service.ts`) walks every layer.

The layers cost the index 56 bytes each (16-byte ulid, 32-byte pack hash, 8-byte size), read on every request: about 7.5 KB of `ghost/ghost`'s 14 KB.

**Index format version 2** adds one optional section after the layers: the checkpoint's seq and the SHA-256 of its pack. An index without a checkpoint is still written as version 1, byte for byte as today, so a repository never compacted keeps its exact bytes. A version 1 reader refuses version 2 with `unsupported index version` (`wal-codec.ts`), which is the intended failure: a node that does not know checkpoints stops rather than serve a repository it cannot read.

**Every writer carries the checkpoint forward.** The push commit point, the tombstone, fork `copyLog` and repair each build the next index field by field, so each must copy the checkpoint, except:

- the tombstone drops it, since a deleted repository has nothing to read;
- a fork keeps it, and copies the checkpoint's objects before the fork's index, as it copies layers;
- repair drops it whenever it replaces a layer's bytes, because the checkpoint was built from the old bytes.

Purge deletes everything under `repos/<repoId>/`, not just `entries/`.

**A checkpoint is an optimisation, never the truth.** If it is missing, or the downloaded pack's SHA-256 differs from the index, replay logs a warning and replays every layer, as today.

**The compactor** is `src/scripts/compact-repositories.ts`, a second entrypoint of the API build shaped like `repair-repositories.ts`: it loads only the modules it needs and opens no listener. A scheduled job (a Railway cron service on the API image) runs it, so it is as ephemeral as the API. It reuses the codec and `WalStoreService`, so the index format and its compare-and-swap have one implementation; a port to another language could drift from it and corrupt every log.

For each repository with at least `COMPACT_MIN_LAYERS` layers past its checkpoint:

1. Read the index and its etag. Pick N, the newest layer older than one hour, which keeps clear of a push still retrying its compare-and-swap and of pull ref writes inside their one-hour grace (`PENDING_GRACE_MS`).
2. Replay layers 1 to N into an empty scratch repository, never the cache: the cache holds objects the log never received ([0034](../../0034-a-push-is-verified-before-the-log-commits-it.md)).
3. `git repack -a -d --keep-unreachable`, so the checkpoint holds a superset of the layers' objects and no later layer can miss a base.
4. Verify that every object in the layers is in the pack and that every ref at seq N walks. Otherwise leave the index alone and report.
5. Upload `<N>.pack`, then `<N>.idx`.
6. Compare-and-swap the index with the checkpoint set and nothing else changed. If a push wins, re-read and try again: N names layers that already existed, so the checkpoint stays valid.

A crash leaves at most an unreferenced checkpoint object, which the next run overwrites under the same name. Checkpoint bytes are not billed in step A; they are derived from layers the owner already pays for.

`--revert <repository>` swaps the index back to version 1 without the checkpoint.

**Rollout:**

1. Readers: decode both versions, install checkpoints, fall back to full replay, carry the checkpoint through every writer. Nothing writes one yet, so this deploy changes no behaviour. A test decodes the production `ghost/ghost` index and re-encodes it to the same bytes.
2. `--dry-run`: build and verify checkpoints in scratch, report sizes, upload nothing.
3. Compact `ghost/ghost` alone and check a cold open in the API log.
4. Every repository, on a schedule.

### Step B: trim the index

Set `compactedThroughSeq = N` and keep only the layers after N. Replay and push retry already number layers as `compactedThroughSeq + offset + 1`. A trimmed index always carries a checkpoint, so it is always version 2, and a node that does not know checkpoints cannot misread `compactedThroughSeq > 0` and skip objects.

Each reader changes first:

| Reader | Change |
|---|---|
| Pull ref accounting | The compactor reconciles every pending write for the repository before trimming. A layer a pending write still names is never trimmed. |
| Storage billing | One transaction through the quota service replaces the trimmed layers' `repository_log_entry` rows with one row for the checkpoint. Repacking dedupes, so this usually lowers the bill: 16 MB against 23.9 MB for `ghost/ghost`. |
| Fork | Copies the checkpoint and the remaining layers; bills the checkpoint's size plus theirs. |
| Push retry | Nothing: it only looks for its own layer, younger than an hour. |
| Repair | Replays from the checkpoint as its base; can still rewrite the remaining layers. The checkpoint is trusted because it was verified when built. |

Once layers 1 to N leave the index, the checkpoint is their only path: the full-replay fallback is gone. So step B also needs:

- the SHA-256 checked on every install, failing the open rather than serving a partial repository;
- the previous checkpoint kept until the next one has aged;
- every trim logged with its N and checkpoint hash.

Undoing a trim rebuilds the full layer list from the entries, which are still in the bucket, through the same compare-and-swap, and restores per-layer billing.

### Step C: delete trimmed entries

Delete an entry only once it has been trimmed for more than a day, because a node that read an older index mid-replay may still be fetching it. This is the grace-period trap in [0010](../../0010-orphans-are-garbage.md); replays take seconds, so a day is wide. Older checkpoints go by the same rule.

This is the only irreversible step. It runs under its own flag, off by default, and is turned on by hand once steps A and B have run cleanly for a few weeks.

## Not in scope

- Speeding up replay itself: fetching the next layers while `index-pack` runs, or storing a `.idx` per layer. Each removes only half the per-layer cost and still grows with history.
- The redundant re-index after a push: the push path leaves the cache marker stale on purpose ([0012](../../0012-forward-only-materialization.md)), so the next read re-indexes that push's pack once.
- Multi-pack maintenance (`git repack`, `multi-pack-index`) inside a warm cache.
