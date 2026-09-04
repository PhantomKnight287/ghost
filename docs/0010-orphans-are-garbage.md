# 0010 — Orphaned entries are garbage, never corruption

**Status:** adopted (collector not yet built)

## Decision

The entry upload happens *outside* the retry loop and is never rolled back. An
entry that no index references is dead weight to be swept later, and is not an
error condition.

## Why

This is what makes [0005](0005-single-commit-point.md) work. The expensive,
slow, unbounded part of a push (uploading a packfile) is deliberately
uncoordinated: content-addressed, idempotent, order-independent. Only the tiny
index write is contended. If the expensive part needed rollback, the design
would need a distributed transaction; because it does not, it needs one
conditional PUT.

An unreferenced packfile is invisible to every reader. Nothing resolves it,
nothing serves it, it costs storage and nothing else.

## The trap in the collector

The obvious sweep — "delete entries no index references" — is **wrong on its
own**. An entry being uploaded right now is legitimately unreferenced for the
duration of the upload plus the CAS. Deleting it destroys an in-flight push.

The sweep must be: unreferenced **and** older than a generous grace period,
hours rather than minutes, exceeding the longest plausible push. The ULID's
embedded timestamp supplies the age with no extra bookkeeping.

## Consequence

Storage grows with failed pushes until the collector exists. At current volume
this is not urgent, but it is unbounded, so it is tracked in
[0011](0011-deferred.md).
