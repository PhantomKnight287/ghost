# 0039 — A pull request's commits are recorded in its timeline as each push lands

**Status:** adopted

## Decision

Opening a pull request, and every later push that moves its head, writes `issue_event` rows: one `committed` row per commit the push added, and a `head_force_pushed` row first when the push rewrote the branch. The timeline shows a person's commits in a row as one "added N commits" block.

A push added the commits its new head reaches that neither its old head nor the base branch does. Base commits pulled in by merging or rebasing onto the base never show, matching the request's own commit list.

`PullRequestPushesService.recordPush` is the one place this happens, and every writer of a branch calls it after the push lands: git pushes over HTTP and SSH, applied suggestions, and merges into a branch another request is from. Imports call it for none of their pushes.

A `committed` row keeps the commit's subject and author name, so it still reads after a force push leaves the commit unreachable.

## Why

Reading commits from git when the timeline loads would place them by commit date, which the author's machine sets and a rebase rewrites, and a force push would erase the old commits without a trace. Rows record when each push actually happened and who made it.

## Consequences

- Requests opened before this change show no commits for what was pushed before it.
- One push adds at most 250 commits to a timeline, the newest ones.
- A push that lands while the API cannot write the rows, or that crashes between the two, leaves its commits out. Nothing reconciles them.
- The commit's author is shown as git recorded the name, not linked to an account.
