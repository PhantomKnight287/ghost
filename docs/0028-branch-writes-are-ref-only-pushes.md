# 0028 — Branch writes from the API are ref-only pushes

**Status:** adopted

## Decision

`POST /repositories/:owner/:repo/branches` and `DELETE /repositories/:owner/:repo/branches/:branch` need write access. Each goes through `commitPush` as one transition with an empty pack: a create moves `refs/heads/<name>` from the zero oid to an existing commit, a delete moves it from the tip it read back to the zero oid. No object is written, since every commit a branch can point at is already in the log.

A new branch starts at a branch, tag or sha, or at the default branch when none is given. Names are checked with `git check-ref-format`; a leading `-` and `HEAD` are refused.

Deleting refuses the default branch and any branch an open pull request uses as its base or head, in this repository or across a fork.

## Why

The log is the only source of truth for refs ([0005](0005-single-commit-point.md)), so the API writes branches the same way `git push` and `git push --delete` do. A push that moves or creates the branch between the read and the write loses nothing: the compare-and-swap rejects the API call with a conflict.

A pull request stores only branch names, so deleting its base or head would leave it comparing nothing. Refusing is simpler than GitHub's close-on-delete, and the pull request can be closed or merged first.

## Consequences

- `git push --delete` still removes any branch, default or in use; only the API refuses.
- Branch protection is deferred; it belongs in the same check once there is something to protect.
