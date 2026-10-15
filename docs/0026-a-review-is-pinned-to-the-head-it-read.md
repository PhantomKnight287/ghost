# 0026 — A review is pinned to the head it read, and threads hang off its line comments

**Status:** adopted

## Decision

A review is a `pull_request_review` row: a verdict (`commented`, `approved`, `changes_requested`), an optional summary, and the sha it read. Line comments are `pull_request_review_comment` rows naming a path, a side of the diff (`deletions` or `additions`), a line on that side, and the sha they were written against. That sha is the head, unless a client of the GitHub API names an earlier commit of the request with `commit_id`; then the comment is checked against that commit's diff from its own merge base, and a commit that no longer reaches the head, such as one a force-push dropped, is refused. A comment on several lines adds `startLine` and `startSide`; the thread hangs off its last line.

A review with no `submittedAt` is pending: the reviewer's unsent batch, with no verdict, visible to nobody else. There is at most one per reviewer and request, enforced by a partial unique index. "Start a review" adds a comment to it, `POST /pulls/:number/reviews` submits it with a verdict and summary, and discarding deletes it with its comments. "Add single comment" is the same submit with one comment and no pending review.

A line comment starts a thread. A reply is a row with `inReplyToId`, and the only comment of a submitted comment-only review of its own, as on GitHub, so every comment has a review and the GitHub API can name it. Replies copy the thread's path, line and sha, and a reply to a reply joins the root's thread. The conversation shows a reply in its thread and leaves its review out. Pending comments take no replies until submitted.

Every comment must sit inside a hunk of the diff as it stands, on the side it names, read from `git diff` hunk headers; both ends of a range must, and a range on one side starts before it ends. The files tab shows threads whose sha is the head it shows; the rest are outdated and stay in the conversation. A thread's first comment also stores `diffHunk`, the rows of the diff it points at with a few rows of lead-in, taken when it is written; the conversation shows those rows above the thread, the way GitHub does, without reading git or caring where the head has moved since.

A reviewer's standing verdict is their latest approval or request for changes; a later comment-only review, a reply's included, leaves it in place. Anyone with `write` can dismiss it with a message, after which that reviewer has no standing verdict; an older one does not come back. Verdicts do not gate merging: that is branch protection's job.

Only its author edits a comment or summary, so nobody's words are changed under their name; authors and `write` delete comments. Deleting a thread's first comment deletes its replies, and every comment-only review left with nothing to say, the replies' own included, goes with them.

`#123` in a summary, line comment or reply is recorded like a comment's, keyed by the review or comment id. A pending comment's mentions are recorded when it is submitted.

A ```` ```suggestion ```` block in a comment proposes replacement text for the lines the comment covers. Applying it builds a commit on the head with a throwaway index, so the cache's own index is never touched, and pushes it through the head repository's `commitPush` like any push ([0016](0016-a-pull-request-spans-two-logs.md)). It takes `write` on the head repository, which for a fork is the fork, and only applies while the head is still the commit the comment was made on: a suggestion made against an older head would replace whatever lines have moved into its place. Only lines on the head side can be replaced, in a text file under the blob size limit.

A draft is `pull_request.draft`. It cannot be merged. The author or anyone with `write` marks it ready or turns it back into a draft, which records `ready_for_review` or `converted_to_draft`.

## Why

Pinning to the sha is what [0016](0016-a-pull-request-spans-two-logs.md) already does for `headSha`: the diff a reviewer read stays addressable after the branch moves on. Remapping a comment's line across pushes means diffing the old head against the new one for every comment on every read; dropping outdated comments from the diff is what makes the rest cheap, and the conversation still carries them.

Pending is `submittedAt is null` rather than a `pending` verdict. A partial index cannot compare an enum (the cast is not immutable), and a value added to an enum cannot be used in the transaction that adds it, which is how migrations run.

Anyone who can read a request may review it and reply, the same bar as commenting ([0021](0021-access-is-a-role-ladder.md)). The author may comment on their own request but not approve it or request changes on it.

## Consequences

- The suggestion commit is authored by whoever applied it, not by the reviewer who suggested it; its subject names the reviewer.
- Suggestions are applied one at a time. Batching several into one commit is the next step if that gets tedious.
- Dismissing records no timeline event of its own; the review shows who dismissed it and why.
