# 0016 — A pull request spans two logs, and lends objects rather than copying them

**Status:** adopted

## Decision

A pull request is a database row naming two `(repository, ref)` pairs. It stores
no git state of its own: no `refs/pull/*`, no snapshot branch, no copied
objects.

Everything the request needs to answer — the merge base, the commit list, the
diff, whether it merges cleanly — is computed from the two repositories' caches
at read time, with the other side's object store lent through
`GIT_ALTERNATE_OBJECT_DIRECTORIES`.

The merge itself is an ordinary push: a merge commit and a packfile, handed to
`PushTransactionService.commitPush`, the same commit point a `git push` uses.

## The problem this exists to solve

[0004](0004-object-storage-is-the-truth.md) gives every repository its own
write-ahead log, keyed by the repository row id:

```
repos/<repositoryId>/index
repos/<repositoryId>/entries/<ulid>.pack
```

`forkRepository` calls `WalStoreService.copyLog`, which copies the parent's
layers into the fork's keyspace and writes an index naming them. After that
instant the two logs never exchange another byte. They are independent, they
advance on different sequence numbers, and neither can read the other.

So a fork request is a diff between two commits that live in **two different
object stores**. Nothing in the read path could see both until this decision.

## Worked example

### Case 1 — a branch in one repository

Alice owns `alice/repo-a`. She branches `feature` off `main` and pushes.

```
repos/repo_a1b2/index    seq 4
                         refs { refs/heads/main: A3, refs/heads/feature: A5 }
                         layers [L1, L2, L3, L4]

/tmp/ghost/repo_a1b2.git   ghost-wal-seq: 4
```

One log. `commitPush` wrote both refs, so `A3` and `A5` are both reachable from
layers `L1..L4`. Nothing is lent, because there is nothing to lend:

```
merge-base A3 A5   → A2
diff --numstat A2 A5
log A2..A5
```

Merging builds a merge commit `M` and packs it with **both** tips excluded,
because both are already in the log:

```
pack-objects --revs   ←  "M\n^A3\n^A5\n"       one object
```

```ts
commitPush({
  repoId: 'repo_a1b2',
  transitions: [{ ref: 'refs/heads/main', oldOid: A3, newOid: M }],
  body: fileBody(pack.path, pack.size),
  packOffset: 0,
})
```

Result: seq 5, `refs { main: M, feature: A5 }`. The head branch is left alone.

Deleting it on merge is one more transition in the *same* entry, because
`applyTransitions` reads `ZERO_OID` as a delete:

```ts
{ ref: 'refs/heads/feature', oldOid: A5, newOid: ZERO_OID }
```

That would make "merge and delete the branch" a single compare-and-swap rather
than two. It is deliberately not wired to the merge endpoint: it only ever works
for a request inside one repository, since a fork's branch lives in a log this
push cannot touch, and whether to delete is the author's call rather than a
default.

### Case 2 — a fork

Alice forks `bob/repo` to `alice/repo-b`, branches `feature`, and opens a
request back into `bob/repo`.

**Before the fork**, Bob is at seq 3:

```
repos/repo_bob/index      seq 3, refs { main: B3 }, layers [L1, L2, L3]
```

**The fork** copies the layers byte for byte and writes an index naming them:

```
repos/repo_alice/index    seq 3, refs { main: B3 }, layers [L1, L2, L3]
```

Same ULIDs, same bytes, separate keyspace. This is the last time the two logs
agree on anything.

**Alice pushes `feature`**, and independently **Bob pushes to `main`**:

```
repos/repo_alice/index    seq 4, refs { main: B3, feature: A1 }, layers [L1..L4]
repos/repo_bob/index      seq 4, refs { main: B4 },              layers [L1, L2, L3, L4']
```

Both read seq 4. The numbers are unrelated: `L4` and `L4'` are different ULIDs
holding different objects. **Alice's log has no `B4`. Bob's log has no `A1`.**
Neither cache can answer `merge-base B4 A1` on its own — `cat-file -t` on the
other side's tip fails outright.

**Reading the request.** Materialize both caches, then run every command in the
base's directory with the head's object store lent to it:

```
GIT_DIR=/tmp/ghost/repo_bob.git
GIT_ALTERNATE_OBJECT_DIRECTORIES=/tmp/ghost/repo_alice.git/objects

git merge-base B4 A1        → B3
git diff --numstat B3 A1
git log B3..A1
git merge-tree --write-tree B4 A1
```

Zero bytes are copied, nothing is written to either repository, and there is
nothing to clean up afterwards.

**Merging.** Same lent store, and the pack is where the care goes:

```
git merge-tree --write-tree B4 A1          → T
git commit-tree T -p B4 -p A1 -m "..."     → M
printf "M\n^B4\n" | git pack-objects --revs <prefix>
```

```ts
commitPush({
  repoId: 'repo_bob',
  transitions: [{ ref: 'refs/heads/main', oldOid: B4, newOid: M }],
  body: fileBody(pack.path, pack.size),
  packOffset: 0,
  pushedBy: bobUserId,
})
```

```
repos/repo_bob/index      seq 5, refs { main: M }, layers [L1, L2, L3, L4', L5']
repos/repo_alice/index    seq 4   ← untouched
```

Bob's log is self-contained again. Alice's fork is unchanged and her `feature`
branch still exists. Only bytes crossed, and they crossed as a normal push.

## Why alternates instead of a fetch

The obvious alternative is `git fetch <otherCacheDir> <sha>` before each read.
Three things are wrong with it:

- Fetching a raw sha needs `uploadpack.allowAnySHA1InWant` on the source, so it
  either requires config on every cache or an `--upload-pack` override.
- Fetching a *ref* instead lands in `FETCH_HEAD`, which is a single file per
  repository. Two concurrent requests against the same base clobber each
  other's.
- It copies objects that already exist a directory away.

A scratch ref is worse. `reconcileRefs` deletes every ref the index snapshot
does not carry, and its `for-each-ref` has no namespace filter, so a
`refs/ghost/pr/*` ref survives exactly until the next push lands on that
repository — the kind of lifetime that works in development and fails under
traffic.

Alternates have none of these problems: process-scoped, no file, no copy, no
cleanup, and safe under concurrency because nothing is written.

## The pack must exclude the base, never the head

This is the one place a wrong shortcut is unrecoverable.

In case 1, `^A3 ^A5` was correct because both tips were already in that log. The
same instinct applied to case 2 — excluding `A1` because "we can see it" — writes
an entry containing only `M`. Bob's log is then permanently broken: a node that
replays `L1..L4', L5'` gets a merge commit whose second parent is unreachable,
and `index-pack --fix-thin` cannot help, because there is nothing on that node
to complete the pack against.

So the exclusion set is what the **target log** already holds, never what the
current process happens to be able to see:

```
include: M
exclude: [B4]          the base tip, and only the base tip
```

Everything reachable from `M` and not from `B4` — the merge commit, `A1`, and
every tree and blob Alice introduced — is read through the alternate and written
into the pack. `merge.spec.ts` builds exactly this pack, replays it into a bare
repository that has only the base's objects, and asserts the full history walks.

## Conflicts and errors both exit 1

`git merge-tree --write-tree` exits 1 for a conflict *and* for a commit it
cannot read. They are told apart by stderr: a conflict writes the tree and the
conflicted paths to stdout and leaves stderr empty; an unreadable commit writes
`not something we can merge` to stderr.

Treating every exit 1 as a conflict is the dangerous reading — a fork whose
objects were never lent would report "conflicts" instead of failing, and the
bug would look like a product decision. `mergeTree` returns null only on exit 1
with empty stderr, and rethrows otherwise.

## Concurrency

`assertFastForward` is a compare-and-swap on the expected `oldOid`, with no
ancestry check of its own. A merge commit therefore passes it exactly when the
base tip is still what the merge was built against.

If Bob pushes `B5` while a merge is in flight, the CAS fails with
`NonFastForwardError` and the merge is retried from `merge-tree` against `B5`.
The entry already uploaded is orphaned, which [0010](0010-orphans-are-garbage.md)
defines as garbage rather than corruption, so there is nothing to unwind.

Mergeability is never stored. It is a function of two moving branch tips, and a
cached answer is wrong the moment either side is pushed to.

## What the API exposes

```
POST   /api/repositories/:username/:repo/pulls
GET    /api/repositories/:username/:repo/pulls
GET    /api/repositories/:username/:repo/pulls/:number
GET    /api/repositories/:username/:repo/pulls/:number/commits
GET    /api/repositories/:username/:repo/pulls/:number/files
GET    /api/repositories/:username/:repo/pulls/:number/patch
POST   /api/repositories/:username/:repo/pulls/:number/merge
PATCH  /api/repositories/:username/:repo/pulls/:number/close
```

`head` is `branch` for a request inside one repository and `owner:branch` for a
fork. `owner:branch` resolves only within the fork network — the base itself, a
fork of the base, or the repository the base was forked from — because two
repositories with no `parentRepositoryId` between them are not a pull request,
they are unrelated history.

Base visibility governs every read: a request from a private fork into a public
repository is readable by anyone who can read the base, which is the same rule
the diff itself implies. Merging requires write on the base. Closing requires
the author or write on the base.

`number` is allocated per base repository with
`select coalesce(max(number), 0) + 1`, which two concurrent opens can read
identically. The unique index on `(baseRepositoryId, number)` rejects the loser,
and the retry reads the winner's number. A partial unique index on
`(baseRepositoryId, baseRef, headRepositoryId, headRef) where state = 'open'`
stops duplicate open requests for a branch pair, while leaving closed and merged
rows as history so the same branch can be proposed again.

## Consequences

- A pull request holds no git state, so nothing about it can drift from the
  repositories it describes.
- Reading one costs two `readIndex` calls (both usually no-ops, since
  `materialize` returns early when the cache is at the index seq) and a handful
  of git processes. No object is ever copied for a read.
- Both caches must be on the same node. That is already true of every read path,
  and it is the assumption to revisit first if the API is ever sharded by
  repository.
- The merge pack excludes only the base tip, so objects on the base's *other*
  branches can be packed a second time. That is entry size, not correctness;
  excluding every base ref is the fix if it ever matters.
- Renaming a user or a repository is now safe. Logs and caches are keyed by row
  id, which is what [0011](0011-deferred.md) asked for and what makes a stored
  cross-repository reference meaningful at rest.
