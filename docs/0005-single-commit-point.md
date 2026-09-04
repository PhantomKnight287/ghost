# 0005 — One commit point per push, and it is a compare-and-swap

**Status:** adopted

## Decision

A push has exactly one moment at which it becomes real: the conditional `PUT`
of `repos/<repoId>/index`. Before it, nothing happened. After it, everything
happened.

```
1. parse the receive-pack body            → transitions + packfile
2. PUT entries/<ulid>.pack                 → durable, unconditional, idempotent
3. read index (etag)                       → current refs
4. validate every oldOid against refs      → reject non-fast-forward
5. PUT index  If-Match: <etag>             → ← THE COMMIT
6. update the local cache, ack the client
```

## Why this works without a transaction manager

Two kinds of data, only one of which needs atomicity:

- **Objects are content-addressed and immutable.** Uploading one twice is
  harmless. Uploading one nobody references is garbage, not corruption. No
  coordination required.
- **Refs are mutable and are the only thing that must be atomic.**

So a push writes a lot of bytes with no coordination at all, then flips one
pointer atomically. There is no partial state to reason about.

A multi-ref push is a single index write, so it is all-or-nothing — stronger
than local git, which is only atomic under `--atomic`.

## Failure taxonomy

| Failure point | Result |
|---|---|
| Before the entry upload | Nothing changed |
| After the entry, before the CAS | Nothing changed; one orphaned entry |
| CAS returns 412 / 409 | Retry (see [0007](0007-optimistic-concurrency.md)) |
| CAS times out, outcome unknown | Resolved by ULID read-back |
| After CAS 200 | Committed; client retries are idempotent |

## S3 specifics that are easy to get wrong

- **`ETag` is opaque.** Echo it back exactly as received, quotes included. For
  multipart objects it is not a content hash — never parse or compare it.
- **The index must never go multipart**, or the ETag stops being usable for
  `If-Match`. It is a small `Buffer`, so it never will.
- **409 is not a failure.** `ConditionalRequestConflict` means two conditional
  writes collided and the caller should retry. `412 PreconditionFailed` means
  the race was genuinely lost. Catching only 412 produces 500s under
  concurrency that look like storage flakiness.
- **`IfNoneMatch: '*'` on the first push** closes the bootstrap race where two
  pushes to a new repository both observe "no index".
- **There is no fsync here.** The HTTP 200 *is* the flush.

## Portability caveat

`S3_ENDPOINT` is configurable. R2 supports both `If-Match` and `If-None-Match`
on `PUT`. Older MinIO supports only `If-None-Match`. If the deployment target
lacks `If-Match`, the fallback is to make the index immutable too
(`index/<seq>` written with `If-None-Match`), which is the more portable shape.
Verify against the real endpoint before depending on `If-Match`.
