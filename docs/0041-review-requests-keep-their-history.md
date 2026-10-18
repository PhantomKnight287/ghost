# 0041 — Review requests keep their history, and ownership is read from the base branch

**Status:** adopted

## Decision

A review request that is removed or answered keeps its row. It gets `cleared_at` and a `cleared_reason` of `reviewed` or `removed`, and only rows with `cleared_at` null count as pending. A re-request inserts a new row.

CODEOWNERS is read from the pull request's base branch, never its head. The file is the first of `.ghost/CODEOWNERS`, `.github/CODEOWNERS`, `CODEOWNERS` and `docs/CODEOWNERS` that exists, as on GitHub with `.ghost/CODEOWNERS` added in front.

A code owner is requested automatically only if they have never had a request on the pull request, pending or cleared. Automatic requests are attributed to the pull request's author.

## Why

A push that touches a file adds its owners again. If cleared requests were deleted, an owner who already reviewed would be asked once more by every later push, and a request someone removed by hand would come back. Keeping the rows lets "never requested" be one query, and keeps the timeline and `onBehalfOf` intact.

Reading ownership from the head would let a pull request edit CODEOWNERS to remove its own reviewers. The base branch is the state the owners agreed to.

## Consequences

- The review-request table grows with every re-request. Rows go with the pull request.
- An owner added to CODEOWNERS after a pull request opened is requested on the next push that touches their files, not before.
- A pull request that changes CODEOWNERS does not change who is requested for it until it merges.
- The "require review from code owners" rule will check CODEOWNERS on the base branch at merge time. It waits for rulesets (#17).
