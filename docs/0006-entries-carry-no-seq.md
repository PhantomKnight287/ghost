# 0006 — Entries carry no sequence number

**Status:** adopted — reverses an earlier design

## Decision

Entry objects are keyed `repos/<repoId>/entries/<ulid>.pack` and their headers
contain no `seq`. Ordering lives exclusively in the index's `layers` array,
where position *i* is sequence `compactedThroughSeq + i + 1`.

## Why the earlier `entries/<seq>-<ulid>.pack` could not work

**The key was not a fence.** Two writers both read `seq = 5`, both write
`entries/6-<ulidA>` and `entries/6-<ulidB>`. Different keys. Both succeed. The
seq prefix looks like it serializes writers and does not — only the index CAS
actually fences.

**And fatally: seq is assigned before the CAS, and the CAS can lose.** A writer
that loses at 6 and retries as 7 has already uploaded a possibly very large
object named `6-…` whose header claims `seq: 6`. The only repairs are
re-uploading the packfile on every retry, or storing a value known to be wrong.

With seq removed, a lost CAS costs nothing: the retry reuses the same key and
the same already-uploaded bytes. `push-transaction.service.ts` uploads the entry
once, before the retry loop, and never again.

## What is lost, and why it does not matter

Ordering is no longer readable from a bare `LIST`. But ULIDs are
time-sortable, so a listing still yields approximate order for disaster
recovery, and each entry header carries its own ref transitions — enough to
rebuild an index from scratch if one were ever lost.

## Consequence

The ULID doubles as the push's idempotency key. On an ambiguous CAS outcome,
`commitPush` checks whether `index.layers` already contains its ULID; if so the
push committed and it returns success rather than reporting a spurious
non-fast-forward.
