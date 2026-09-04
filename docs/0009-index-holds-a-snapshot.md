# 0009 — The index holds a ref snapshot, not a diff

**Status:** adopted

## Decision

`WalIndex.refs` is the complete current ref map. Entries hold the *transitions*
(`oldOid → newOid`); the index holds the *result*.

## Why store both

They answer different questions and both are needed:

- **The index's snapshot** answers "what does `main` point to right now?" in one
  GET, with no history folding. This is the hot path: every `info/refs`
  advertisement and every materialization needs it.
- **The entries' transitions** answer "what did `main` point to at push 37?"
  Replaying them reconstructs ref state at any point in history — reflog, audit,
  and point-in-time restore, none of which a snapshot alone can provide.

Storing only transitions makes every read O(history). Storing only the snapshot
throws away the capability that motivated the log.

## Where each field comes from

Every field has exactly one source, which is what makes the format defensible:

| Field | Source |
|---|---|
| `transitions` | **The client sent it** — parsed from the pkt-line command section |
| `packSha`, `size` | **Computed** from the packfile bytes |
| `ulid`, `createdAt`, `pushedBy` | **Assigned** by the server at push time |
| `seq` | **Assigned** — `previous.seq + 1`, inside the CAS |
| `refs` | **Computed** — previous `refs` with this push's transitions applied |
| `layers` | **Computed** — previous `layers` plus this entry |
| `compactedThroughSeq` | **Assigned** by compaction only; carried forward otherwise |

Nothing is invented. The client supplies *what* changed, the server assigns
*when/who/which-number*, and *where* and *the resulting state* are derived.

## Deletes

A transition whose `newOid` is all zeroes is a ref deletion.
`applyTransitions` removes the key rather than storing a zero oid, so a deleted
ref is absent from the snapshot while the deletion remains visible in history.
