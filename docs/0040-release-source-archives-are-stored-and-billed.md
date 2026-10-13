# 0040 — A release's source archives are stored, and billed like its assets

**Status:** adopted

## Decision

Every release keeps a zip and a gzipped tarball of its tag's tree in object storage, at `release-assets/<repositoryId>/<releaseId>/source.zip` and `source.tar.gz`. The `release` row records the commit they were built from (`source_commit_sha`), their sizes and a download count per format. Any other ref, a branch or a bare sha, is archived on the fly and never stored.

Creating a release starts the build without waiting for it. Each archive is spooled to a temp file, since an upload needs its length before the first byte and `git archive` only knows it at the last, then uploaded and recorded. A download that finds no archive for the tag's current commit, because the build died with its process or a push moved the tag ([0024](0024-tags-live-in-git-releases-in-rows.md)), builds it before serving it.

The archives bill the account that owns the repository, as the release's uploaded assets do ([0025](0025-storage-is-billed-to-the-owning-account.md), [0037](0037-release-assets-count-against-their-own-quota.md)): the `asset` limit, or the `fork` limit in a fork. Their size is unknown until they are built, so there is no reservation. Creating a release needs room left, not room enough, as a merge does: a release is refused with 413 once the account is at or past its limit, and the archives of the last one admitted may carry it past.

A download of a release's tag streams the stored bytes with a `Content-Length` and counts once per full response; a 304 is not a download. A draft's archives are counted only for people who can see the draft.

## Why

A stored archive is built once per commit instead of once per download, it has a size the release page can show, and a download can be counted. Columns on `release` rather than rows in `release_asset` keep every query over uploaded assets meaning what it did: the quota sum, GitHub's `assets` list and the rename and delete endpoints never see a file the user did not upload.

Building in the background keeps creating a release as fast as tagging; the repair on download makes a lost build harmless. The outbox was not used: a consumer holds its batch's row locks for as long as it runs, and an archive of a large tree would hold up notifications and webhooks behind it.

## Consequences

- Release archives for a moved tag are rebuilt on the next download; until then the release page shows them without a size.
- A tag deleted under a release leaves its archives stored, and billed, until the release is deleted.
- Two downloads of a stale archive at once both rebuild it; the bytes are the same, so the second upload only repeats the first.
- An account refused a release can still delete releases and assets to make room.
