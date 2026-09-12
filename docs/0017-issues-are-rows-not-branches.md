# 0017 — Issues are rows, not branches

**Status:** adopted

## Decision

An issue is a database row naming one repository. It stores no git state of its
own: no ref, no commit, no tree. Everything it needs — title, markdown body,
open/closed state, labels, assignees, comments — is relational, so unlike
[0016](0016-a-pull-request-spans-two-logs.md) there is nothing to materialize,
no object store to lend, and no cache to keep coherent.

Six tables carry the feature:

```
issue               the issue itself; `number` is per repository, 1-based
issue_comment       timeline comments, oldest first
label               repository-scoped name + description + 6-char hex color
issue_label         issue ↔ label, composite primary key
issue_assignee      issue ↔ user, composite primary key
issue_event         opened/closed/reopened/renamed/edited/labeled/unlabeled/
                    assigned/unassigned, oldest first
```

`issue_event` is what GitHub renders between comments. Only the columns relevant
to `type` are set — `labelName` for labeled/unlabeled, `assigneeUsername` for
assigned/unassigned, `oldTitle`/`newTitle` for renamed. The timeline endpoint
returns comments and events interleaved oldest-first, exactly as rendered.

## The problem this exists to solve

Pull requests are diffs with a conversation attached. Issues are the
conversation without the diff: a bug report, a task, an idea. They need the same
social machinery — numbers, states, comments, labels, assignees, search — but
none of the git machinery. Modeling them as rows keeps that split explicit: the
write-ahead log never learns about issues, and issues never touch the log.

## What the API exposes

```
POST   /api/repositories/:username/:repo/issues
GET    /api/repositories/:username/:repo/issues
GET    /api/repositories/:username/:repo/issues/:number
PATCH  /api/repositories/:username/:repo/issues/:number
POST   /api/repositories/:username/:repo/issues/:number/close
POST   /api/repositories/:username/:repo/issues/:number/reopen
GET    /api/repositories/:username/:repo/issues/:number/comments
POST   /api/repositories/:username/:repo/issues/:number/comments
PATCH  /api/repositories/:username/:repo/issues/:number/comments/:commentId
DELETE /api/repositories/:username/:repo/issues/:number/comments/:commentId
GET    /api/repositories/:username/:repo/issues/:number/timeline
PUT    /api/repositories/:username/:repo/issues/:number/labels
PUT    /api/repositories/:username/:repo/issues/:number/assignees
GET    /api/repositories/:username/:repo/labels
POST   /api/repositories/:username/:repo/labels
PATCH  /api/repositories/:username/:repo/labels/:labelId
DELETE /api/repositories/:username/:repo/labels/:labelId
```

The list endpoint filters by `state`, full-text `q` over title and body,
`author`, `assignee`, and `labels` (comma-separated, AND semantics — an issue
must carry all of them), and sorts by `created`, `updated`, or `comments` in
either direction. It answers `total` plus `openCount`/`closedCount` against the
same filters minus `state`, which is what the Open/Closed tabs render.

Authorization follows the pull-request rule. Reading or opening an issue, or
commenting on one, requires read on the repository — the same bar GitHub sets
for a public repository. Editing, closing, labeling, or assigning requires the
author or write on the repository. Managing the label list itself requires
write.

`number` is allocated per repository with
`select coalesce(max(number), 0) + 1`, with the same unique-index retry as pull
requests: two concurrent opens read the same max, the loser is rejected, and
the retry reads the winner's number.

## Why a denormalized comment count

`sort=comments` needs an orderable column. Counting comments per issue at list
time is a join plus group-by on every call; storing `commentCount` on the issue
makes it one indexed query. Writers bump it on comment create and decrement
(floored at zero) on delete, which is the only place it can drift, and the only
cost of drift is sort order — never correctness of the comments themselves.

## Why label filtering is two queries

An AND over N labels is a group-by-having over the join table, which returns
issue ids, not issues. Running that first and then a single indexed scan with
`inArray` keeps the main query shaped like every other list endpoint — one scan
plus keyset pagination — instead of a bespoke join whose plan changes with the
number of labels. The intermediate id set is bounded by the repository, and an
empty set short-circuits before the main query runs.

## Consequences

- Issues cost no git processes at all. Every endpoint is Postgres plus
  authorization.
- Labels belong to the repository, not the issue, so renaming a label renames
  it everywhere it is used, and deleting a label unlabels every issue carrying
  it through the foreign key.
- Events are write-only history. There is no endpoint to edit or delete one,
  so the timeline can only grow, and "who did what" survives title edits and
  label deletions.
- `commentCount` can drift under concurrent comment create/delete. The drift
  window is one statement wide and self-heals on the next write to that issue.
