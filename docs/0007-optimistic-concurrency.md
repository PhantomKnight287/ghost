# 0007 — Optimistic concurrency, never locks

**Status:** adopted

## Decision

No lock service, no lease, no counter service. Concurrent pushes are resolved
entirely by the conditional `PUT` in [0005](0005-single-commit-point.md) and a
bounded retry loop with jittered backoff.

## Where `seq` comes from

`seq` is `index.seq + 1`, allocated by the writer. It cannot collide because
**allocating it and publishing it are the same atomic act**. Two pushes both
read `seq = 5` and both want 6; one wins the CAS, the other's CAS fails, it
re-reads (now sees 6) and retries as 7.

## Why validation lives inside the loop

Losing the CAS is not the same as failing the push. On each attempt the loop
re-reads the index and re-checks every transition's `oldOid` against the live
ref:

- Push to a different branch → still valid → retries and lands at the next seq.
- Push to the same branch someone just moved → `oldOid` no longer matches →
  `NonFastForwardError`, which is **not** retryable.

Validating once outside the loop would be a lost-update bug that only appears
under concurrency.

## Git supplies the precondition

This is not an invented protocol. `receive-pack` sends `<old-oid> <new-oid>
<ref>` per command. That `old-oid` *is* the compare. The design relocates git's
own compare-and-swap from a local file lock to object storage; it does not add
new semantics.

## The ambiguity case

A `PUT` that times out may still have landed. Retrying blindly would find the
`oldOid` no longer matching and report non-fast-forward for a push that
succeeded. The loop therefore checks for its own ULID in `index.layers` first
(see [0006](0006-entries-carry-no-seq.md)).

## Consequence

`MAX_ATTEMPTS` is 8, after which `WalContentionError` returns 503. Pushes to one
repository serialize even across disjoint refs. That is acceptable: pushes are
rare and short. Per-ref logs would remove the contention and destroy the total
order that makes replay deterministic — not a trade worth making.
