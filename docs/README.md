# Design decisions

One file per decision. Each states the decision, the reasoning, the alternatives
rejected, and the consequences — including the bad ones.

## Transport

- [0001 — Git lives at the root namespace, REST lives under `/api`](0001-namespace-split.md)
- [0002 — The transport layer takes streams, not `Request`/`Response`](0002-streams-not-http-objects.md)
- [0013 — The request body is captured before anything else can await](0013-raw-body-is-captured-first.md)
- [0014 — A flush-only POST is a probe, not a malformed push](0014-the-pre-push-probe.md)
- [0003 — `git/` is not a REST resource](0003-git-is-not-a-resource.md)

## Storage and durability

- [0004 — Object storage is the source of truth, local disk is a cache](0004-object-storage-is-the-truth.md)
- [0005 — One commit point per push, and it is a compare-and-swap](0005-single-commit-point.md)
- [0006 — Entries carry no sequence number](0006-entries-carry-no-seq.md)
- [0007 — Optimistic concurrency, never locks](0007-optimistic-concurrency.md)
- [0008 — The log is a binary format](0008-binary-log-format.md)
- [0009 — The index holds a ref snapshot, not a diff](0009-index-holds-a-snapshot.md)
- [0010 — Orphaned entries are garbage, never corruption](0010-orphans-are-garbage.md)
- [0012 — Materialization is forward-only replay](0012-forward-only-materialization.md)
- [0015 — Nothing holds a packfile in memory](0015-nothing-holds-a-packfile.md)

## Open

- [0011 — Deferred decisions](0011-deferred.md)
