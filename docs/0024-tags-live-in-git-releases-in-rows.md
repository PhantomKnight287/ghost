# 0024 — Tags live in git, releases live in rows

**Status:** adopted

## Decision

A tag is a git ref, `refs/tags/<name>`, and nothing else. There is no tag table: `GET /repositories/:owner/:repo/tags` reads `for-each-ref` from the materialized cache, newest first, peeled to the commit.

A release is a `release` row keyed by `(repositoryId, tagName)`. It holds the notes, the draft and prerelease flags and the author. It stores no commit: each read looks the tag up in git, so a release whose tag was moved by a push follows it, and one whose tag was deleted reports `commitSha: null` rather than a stale sha.

Creating a release for a tag that does not exist yet creates an annotated tag at the requested branch or sha, or the default branch, with the requester as tagger and the release title as its message. A lightweight tag would be dated by its commit, so a tag made today on an old commit would list as months old. The tag goes through `commitPush` like any push: one transition from the zero oid, and a pack holding only the tag object, since the commit is already in the log. A concurrent push of the same tag loses the compare-and-swap and the request fails with a conflict.

"Latest" is computed, never stored: the most recently published release that is neither a draft nor a prerelease.

Deleting a release deletes the row and keeps the tag.

## Why

The log is the only source of truth for refs ([0004](0004-object-storage-is-the-truth.md), [0005](0005-single-commit-point.md)). A tag table would be a second copy that `git push --tags` and `git push --delete` bypass, so it would need reconciling on every push. `for-each-ref` over the cache is cheap next to anything that reads objects, and paging it in memory is fine at the tag counts repositories have.

Writing API-created tags through `commitPush` keeps the rule from [0016](0016-a-pull-request-spans-two-logs.md): nothing reaches a repository except through its commit point.

## Consequences

- Tag names are validated with `git check-ref-format`, and a leading `-` is refused, before anything is written.
- `tree/<tag>` and `blob/<tag>` resolve a tag to its commit and treat it as detached, so tags are never path-indexed.
- A draft creates its tag straight away. GitHub waits until publishing, which would need the target stored on the row; the tag of an unpublished draft is visible to anyone who can read the repository.
- Release assets are not built yet. When they are, they belong in object storage next to avatars, keyed by release id.
