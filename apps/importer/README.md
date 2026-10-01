# @ghost/importer

Imports a GitHub repository into Ghost: its git history, releases, issues, pull requests and issue comments. It is optional; without it the API turns GitHub imports off.

The API drives it. A user starts an import, the API creates the repository and a `repository_import` row, then hands the job to `POST /imports` here with the user's GitHub token and a short-lived Ghost API key. The importer:

1. fetches `refs/heads/*`, `refs/tags/*` and `refs/pull/*/head` from GitHub into a scratch bare repository,
2. pushes them to Ghost over HTTP with the API key, through the same path as any user's push,
3. reads releases, pull requests, issues and comments from the GitHub REST API and sends them to the API in batches,
4. reports the outcome.

Every callback to the API renews the attempt's lease, and a heartbeat runs every 30 seconds. If the importer stops calling back, or refuses a job because it is busy, the API retries the import with backoff, up to six attempts. Each attempt carries a token; once the API moves on to a new attempt it answers the old one with 409, and the importer stops.

Imported issues, pull requests, comments and releases are authored by the `ghost-importer` account, with the original GitHub author credited in the text.

Not imported: release assets, Git LFS objects, review comments on pull request lines, reactions, assignees and milestones.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `IMPORTER_SECRET` | | Shared with the API, which sends it with jobs and receives it with callbacks. At least 16 characters. |
| `GHOST_API_URL` | | Where the importer reaches the API for callbacks and `git push`, such as `http://api:3001`. |
| `PORT` | `3004` | |
| `IMPORTER_CONCURRENCY` | `2` | Imports run at once. Further jobs are refused with 503 and retried by the API. |
| `IMPORTER_WORKDIR` | `$TMPDIR/ghost-importer` | Scratch space for clones. Needs room for the largest repository you import. |

The API needs `IMPORTER_URL` and the same `IMPORTER_SECRET`, plus `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` from a GitHub OAuth app whose callback URL is `<BETTER_AUTH_URL>/api/auth/callback/github`.

## Development

```sh
bun run dev
bun test
```
