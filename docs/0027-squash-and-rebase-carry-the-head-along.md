# 0027 — Squash and rebase carry the head along

**Status:** adopted

## Decision

`POST /pulls/:number/merge` takes `method`: `merge` (the default), `squash` or `rebase`. All three build their result in the base cache and land it through `commitPush`, exactly as [0016](0016-a-pull-request-spans-two-logs.md) describes for the merge commit.

- **merge** is unchanged: `merge-tree`, then a commit with the base tip and the head tip as parents.
- **squash** uses the same `merge-tree` result, committed with the base tip as its only parent. The subject defaults to `<title> (#<number>)` and the body to the head's commit messages; the request's detail carries both as `squash`, and the merger may rewrite either before merging. The author is the request's author and the committer is whoever pressed the button.
- **rebase** replays every non-merge commit in `mergeBase..head` onto the base tip, one `merge-tree --merge-base=<commit>^` per commit. Each copy keeps its author, author date and message; the committer is whoever pressed the button. Merge commits are dropped, the way `git rebase` linearizes a branch.

The pack for every method includes the head tip as well as the new base tip, excluding only the base tip.

## Why the head rides along

A merged request reads its commits and diff from the base cache alone, as `mergeCommit^1..headSha` ([0016, addendum](0016-a-pull-request-spans-two-logs.md)). A merge commit makes the head reachable, so its objects were already in the pack. A squash or a rebase leaves the head unreachable from the base, and for a fork its commits exist in no object the base log holds.

Adding the head to the pack keeps the addendum true for every method, with no new column and no second code path for merged requests:

- `mergeBase(mergeCommit^1, headSha)` is still the commit the branches diverged from, since both the squashed commit's parent and the last rebased commit's parent descend from the base tip.
- The commits tab lists the head's original commits, and review comments pinned to `headSha` stay on the diff they were written against.

The objects are unreachable from any ref, which is safe because nothing prunes a cache: [0012](0012-forward-only-materialization.md) replays every entry with `index-pack`, which keeps everything in the pack.

## Alternatives rejected

- **`git replay`** does the rebase in one call, but it is marked experimental, its output for a raw sha range is empty unless a ref is involved, and writing a scratch ref into a shared cache is what [0016](0016-a-pull-request-spans-two-logs.md) already rejects.
- **Storing the method and the pre-merge base tip** on the row would let a merged request read `baseSha..mergeCommitSha` instead. It loses the original commits for a squash and every review comment's line for both, and needs a migration for a value the pack already answers.

## Consequences

- `mergeable` still reports whether the two tips merge. A rebase can conflict where the merge does not, one commit at a time; that surfaces as a 409 naming the paths of the first commit that failed, and nothing is written but loose objects.
- Rebased commits lose their signatures, the same as any `git rebase`.
- A head made only of merge commits rebases to nothing, and is refused as having nothing to merge.
- The method is the merger's choice on each request, not a repository setting: every writer may use all three.
