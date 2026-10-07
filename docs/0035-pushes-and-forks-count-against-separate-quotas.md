# 0035 — Pushes and forks count against separate quotas, which an account can override

**Status:** adopted

## Decision

An account has four storage limits, one per kind:

| Kind | Environment default | Counts |
| --- | --- | --- |
| `repository` | `STORAGE_QUOTA_BYTES` | Pushed git data and merged pull requests' heads, in repositories that are not forks |
| `fork` | `FORK_STORAGE_QUOTA_BYTES` | The same, plus Git LFS objects and release assets, in forks |
| `lfs` | `LFS_STORAGE_QUOTA_BYTES` | Git LFS objects in repositories that are not forks (0036) |
| `asset` | `ASSET_STORAGE_QUOTA_BYTES` | Release assets in repositories that are not forks (0037), and for a user, the files they attached to issues and comments anywhere (0038) |

A `storage_limit` row, keyed by a user or an organization, overrides any of the four for that account. A null column falls back to the environment, and an unset environment value means unlimited. `StorageQuotaService.quotaOf(account, kind)` is still the one place a limit is decided (see 0025).

Forks get their own limit because people fork large repositories they never push to. Billing that copy against the same quota as their own work would make forking the thing that fills it.

Pushed git data is recorded in `repository_log_entry`, keyed by repository and WAL entry ulid: one row per push, and one per entry a fork copied from its parent. Usage is still summed from rows. A push reserves its bytes the way an upload does (0025): it takes the account's lock, checks the room left, commits the log, and inserts the row, all in one transaction.

`src/scripts/backfill-storage-usage.ts` (`node dist/scripts/backfill-storage-usage.js [--apply]`) bills entries written before this decision. It reads each log's index and records every entry with no row, except those Ghost wrote for pull requests, which are billed through their own rows (0033).

A push refused before the log commits it, for any reason, is answered with a receive-pack report that refuses every ref, so git prints `! [remote rejected] <ref> (<reason>)` over HTTP and SSH alike. A client that asked for no report gets the error status.

## Why

Push sizes live in the WAL index in object storage. Summing them for every quota check would mean one object read per repository. The rows mirror only what the account is billed for, and they disappear with the repository.

## Consequences

- A push that writes nothing, such as a branch delete, goes through even when the account is past its quota.
- A crash between the log's commit point and the transaction's commit leaves that push unbilled. Nothing reconciles it yet.
- Pushes from before this change count for nothing until the backfill runs.
- Ghost's own writes to the log, such as merges, web edits and tags, are not billed as they happen. The backfill bills those it finds.
- A fork whose parent is deleted loses its `parentRepositoryId`, so its bytes move to the `repository` quota.
- A refused push answers with a success status carrying the refusal, as git's own receive-pack does. Tools reading the raw status see 2xx.
