# 0036 — Git LFS objects are stored per repository and served through the API

**Status:** adopted

## Decision

Ghost speaks the Git LFS batch API and its `basic` transfer under the clone URL, beside git's own routes:

| Route | Does |
| --- | --- |
| `POST /<owner>/<repo>.git/info/lfs/objects/batch` | Says which objects to upload, or where to download each |
| `PUT /<owner>/<repo>.git/info/lfs/objects/<oid>` | Stores one object |
| `GET /<owner>/<repo>.git/info/lfs/objects/<oid>` | Serves one object |
| `GET`, `POST /<owner>/<repo>.git/info/lfs/locks` | Lists locks, or locks a path |
| `POST /<owner>/<repo>.git/info/lfs/locks/verify` | The pusher's locks and everyone else's |
| `POST /<owner>/<repo>.git/info/lfs/locks/<id>/unlock` | Unlocks: the owner, or an admin with `force` |

`GitBasicAuthMiddleware` authorizes them as it does git: an upload or a lock change needs write access, a download or a lock list read access. LFS bodies are parsed before it runs, since the batch's operation is in its body. Each action carries the batch request's own `Authorization` header, so the client needs no second credential lookup. Hrefs start with `BETTER_AUTH_URL`, the clone URL's origin.

Objects live at `lfs/<repositoryId>/<oid>`, one `lfs_object` row each. Only SHA-256 oids are accepted. An upload follows the release asset reservation (0025): the row is inserted under the account's lock with an id of its own, the bytes stream to `lfs/<repositoryId>/uploads/<uploadId>` while they are hashed, and only bytes that hash to the oid are copied to the object's key and marked uploaded. Otherwise the staging object and that upload's row are removed. An upload whose reservation lapsed and was taken by another cannot touch its successor's row or bytes. The price is a server-side copy per upload. One object can be at most 5 GiB, what a single `PutObject` carries.

LFS objects count against the `lfs` limit, except in forks, where they count against the `fork` limit like everything else a fork holds (0035).

Forking copies the parent's objects, rows and bytes, inside the fork's transaction, and bills them with the fork. Merging a pull request from another repository copies the objects named by pointer files in the head's own commits (`mergeBase..head`) that the base lacks: the bytes before the merge's transaction, the rows inside it, billed to the base like the merge. Deleting a repository deletes its objects by prefix before the rows go.

Over SSH, `git-lfs-authenticate <repo> <operation>` answers with the HTTPS endpoint and a `Bearer` token signed with `BETTER_AUTH_SECRET`. The token names one user, one repository and one operation, lasts an hour, and is accepted only on that repository's LFS routes; a download token cannot write.

Locks are rows in `lfs_lock`, one per repository and path, listed in path order with the path as the cursor. They are advisory, as on GitHub: git-lfs checks them before a push, and the server does not refuse a push that touches a locked path.

The blob and raw endpoints serve a pointer file as its object when the repository holds it. The blob response's `lfs` field says `stored`, `missing` (the pointer is shown), or `null` for an ordinary file.

## Why

Per-repository copies keep access the same as git's: an object is readable exactly where its repository is. A shared, content-addressed store would save the copy on fork, but would need reference counting before anything could be deleted, and would let anyone who knows an oid claim it without uploading.

Bytes go through the API rather than presigned URLs for the reason 0025 gives: a self-hosted bucket is often reachable only from the API's network.

## Consequences

- A fork copies every LFS object its parent holds, on the request that creates it.
- A merge copies only what the head repository holds. An object the author never pushed stays missing in the base too.
- A merge that fails after copying leaves the copied objects behind, orphans as in 0010.
- `git-lfs-transfer`, the pure-SSH protocol, is refused; git-lfs falls back to `git-lfs-authenticate`.
- A token cannot be revoked before it expires; removing the user's SSH key or access stops new ones, and access is still checked on every request.
- An upload that finishes while its repository is being deleted can leave its object behind, an orphan as in 0010.
- The web UI shows an LFS file as its pointer.
