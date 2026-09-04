# 0011 — Deferred decisions

**Status:** open

Things deliberately not built yet, with the reasoning that will be needed when
they are.

## Authentication

`@OptionalAuth()` is currently blanket on `GitController`, so
`git-receive-pack` accepts anonymous pushes. Git CLI sends HTTP Basic, not the
Better Auth session cookie, so a dedicated guard is required. Three rules it
must encode:

1. `git-receive-pack` always requires authentication.
2. `info/refs?service=git-upload-pack` is anonymous for public repositories.
3. A 401 **must** carry `WWW-Authenticate: Basic realm="Ghost"` or the client
   errors out instead of prompting for credentials.

`pushedBy` threads through `commitPush` already and is written to every entry
header; it is `null` until this lands.

## Repository resolution

`RepositoryStorageService.getRepoPath` writes to `os.tmpdir()` and auto-creates
any repository anyone names — which is why pushing to a non-existent repository
silently succeeds rather than returning 404. It should resolve through
`getRepositoryBySlug`, which currently returns `void` (it only throws or does
not) and needs a real return value before the transport can build on it.

`toRepoId()` returns `username/repo` as a placeholder. It should return the
database row's stable id, so that renaming a user or repository does not orphan
its log.

## Entry uploads are a single PutObject

Streaming landed in [0015](0015-nothing-holds-a-packfile.md), but the entry is
still written with one `PutObject` carrying an explicit `ContentLength`. Within
the 5 GiB single-object limit, but a stream cannot be rewound, so any mid-flight
failure re-uploads the whole entry. `@aws-sdk/lib-storage`'s `Upload` would make
it multipart and resumable. Entries are content-addressed and idempotent, so
this is throughput, not correctness.

## Push failures are reported as JSON, not sideband

`NonFastForwardError` reaches `DomainErrorFilter` and renders as JSON. Git
clients expect failures inside the `report-status` sideband and will show an
unhelpful error. Needs a pkt-line status encoder on the response path.

## Checkpoints and compaction

Reading the whole log on every push is O(history). The plan is
`checkpoint/<repoId>/<seq>` holding a materialized ref map and live layer list,
after which readers fetch the newest checkpoint and only the entries beyond it.

Checkpoints are *derived*, immutable, and named by seq, so writing one is
idempotent, two racing compactors write identical bytes, and a crash mid-write
leaves nothing to clean up. Compaction must stay off the push critical path.
`compactedThroughSeq` exists in the index format for this and is currently
always 0.

## Garbage collection

See [0010](0010-orphans-are-garbage.md), including the grace-period trap.

## `.git` suffix normalization

`git clone host/user/repo.git` and `host/user/repo` must both work. Currently
handled incidentally inside `getRepoPath`'s regex and `toRepoId`. It belongs in
a param pipe once repository lookup is real, so normalization happens once.

## Prior art worth reading first

JGit's DFS backend (`DfsRepository`, `DfsRefDatabase`, `DfsObjDatabase`) is this
design already built and running at scale: git on blob storage with a CAS ref
database. The pack/ref split, the ref-CAS retry loop, and "objects need no
transaction" are all load-bearing there too.
