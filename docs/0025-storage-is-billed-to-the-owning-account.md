# 0025 — Stored files are billed to the owning account, and the quota is configuration

**Status:** adopted

## Decision

Release assets live in object storage under `release-assets/<repositoryId>/<releaseId>/<assetId>`, one `release_asset` row each. Uploads stream from the request to the bucket through the API; the browser never talks to object storage.

Every stored byte is billed to one **account**: the organization a repository belongs to, or its owner when it belongs to none. `STORAGE_QUOTA_BYTES` sets the most any account may store and is unset by default, so a self-hosted instance has no quota until its operator sets one. `RELEASE_ASSET_MAX_BYTES` caps a single file, 2 GiB unless set and never past the 5 GiB a single `PutObject` can carry. Both take bytes or binary units (`1gb`), and a value that does not parse stops the server at boot.

Usage is never stored. It is the sum of `release_asset.size` over the account's repositories, so it cannot drift from what the rows say is kept, and it follows a repository through a transfer.

An upload is a reservation first:

1. In one transaction, under `pg_advisory_xact_lock` on the account, sum the usage, refuse if the new file does not fit, and insert the row as `uploading`.
2. Stream the bytes to the bucket with the declared `Content-Length`.
3. Mark the row `uploaded`. On any failure, delete the row.

`uploading` rows count toward usage for a day, then stop counting; a lapsed one is removed when the same name is uploaded again. Only `uploaded` rows are listed or served.

`StorageQuotaService.quotaOf(account)` is the one place a limit is decided. Today it returns the configured value for everyone; a per-account override, such as a paid plan, is a column read there.

## Why

Summing rows keeps one source of truth. A counter would need updating from every writer, and repairing when a write between the counter and the object fails.

The lock is per account, not global, so only uploads that compete for the same quota wait on each other. Checking without the reservation would let two concurrent uploads each see room for one file and both store it.

Presigned uploads straight to the bucket were rejected: a self-hosted bucket is often only reachable from the API's network, and the API would still have to trust the client to report what it stored.

## Consequences

- An upload without a `Content-Length` is refused with 411: the reservation needs the size before the first byte.
- A process that dies mid-upload holds its reservation for up to a day. The object it may have half-written is never listed; nothing sweeps it yet.
- Lowering the quota, or transferring a repository to a fuller account, can leave an account over its limit. Nothing is deleted; it can read and delete files, and cannot upload until it is back under.
- The SDK neither settles nor surfaces an error from a request body that dies midway, so `S3Service.putStream` aborts the upload itself when its source fails. Without it, a client disconnecting mid-upload crashed the API.
- Deleting a release or a repository deletes its objects by prefix before the rows go.
