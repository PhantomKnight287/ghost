# 0037 — Release assets count against a quota of their own

**Status:** adopted

## Decision

Release assets get a fourth storage kind, `asset`, with `ASSET_STORAGE_QUOTA_BYTES` as its environment default and `storage_limit.asset_bytes` as its per-account override. They no longer count against the `repository` limit, which now holds only pushed git data and merged pull requests' heads.

Assets in forks still count against the `fork` limit, like everything else a fork holds (0035), the same split Git LFS objects follow (0036). `assetKindOf(repository)` picks the kind, as `lfsKindOf` does.

`StorageQuotaService.usageOf(account, kind)` sums only the rows of its kind: log entries and merged pull refs for `repository`, LFS objects for `lfs`, release assets for `asset`, and all of them in forks for `fork`. `RELEASE_ASSET_MAX_BYTES` still caps a single file.

`GET /api/storage/:owner` reports the new limit as `asset`, and its top-level `usedBytes` no longer includes release assets.

## Why

Release binaries grow with every release and are easy to delete and re-upload, while git data is permanent once pushed. Sharing one limit meant a few large releases could stop an account from pushing code, and an operator could not offer generous release storage without also raising the cap on git data.

## Consequences

- An instance that sets `STORAGE_QUOTA_BYTES` and not `ASSET_STORAGE_QUOTA_BYTES` stops limiting release assets on upgrade, since an unset limit means unlimited. Operators who want them capped set the new variable.
- An account that was full only because of release assets can push again after the upgrade.
- Release asset uploads to a fork are still refused by the fork limit, which the release form does not know about; it shows the asset limit, and the API's refusal is the final word.
