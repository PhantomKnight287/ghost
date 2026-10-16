# Commit statuses

Issue: #16 on Ghost (migrated from GitHub #61). Roadmap item 10, first half.

## Intent

External systems have no way to report results on a Ghost commit. The first user is a bot that mirrors GitHub commit statuses onto Ghost: CodeRabbit on pull requests, and Railway's per-service deploy contexts (`Ghost - web`, `Ghost - api`, ...) on `main`. Woodpecker, Drone, Jenkins and similar CI post the same kind of status. Branch protection's required checks (#17) build on this later.

The shape follows GitHub's Statuses API closely, so the mirror bot and existing CI integrations call Ghost exactly as they call GitHub, and `gh pr view` / `gh pr checks` show the results.

## Goals

- External callers create commit statuses through GitHub's REST paths.
- Anyone who can read a repository reads its statuses, per commit and combined.
- The pull request page and commit lists show them.
- `statusCheckRollup` in GraphQL returns them, so `gh pr checks`, `gh pr status` and `gh pr view` work.
- A webhook event fires on each new status.

## Non-goals

- Check runs and check suites (the Checks API). Tracked in #79, blocked by Ghost Apps (#50). The mirror bot skips GitHub check runs.
- Blocking merges on failing checks. That is #17.
- Deployments, deployment statuses and environments.
- Live updates on the page.
- Handling a status posted before its commit reaches Ghost. The caller retries; Ghost just answers 422.

## Anti-goals

- A REST or GraphQL shape that differs from GitHub's where GitHub defines one. The bot must work unchanged against both hosts.
- Mutable statuses. A status is never edited or deleted once written.

## Data

New table `commit_status` in `packages/db/src/schema/` (snake_case columns, per 0030):

- `id`: text, prefixed like other tables (`cst_…`, builder may pick the prefix)
- `repository_id`: references `repository`, cascade on delete
- `sha`: 40-character hex commit id
- `state`: enum `pending`, `success`, `failure`, `error`
- `context`: text, default `default`
- `description`: text, nullable, at most 140 characters
- `target_url`: text, nullable
- `creator_id`: the user behind the API key or session
- `created_at`: timestamptz (per 0018)

Index on `(repository_id, sha, context, created_at desc)`, which serves both the history read and the newest-per-context read.

Rows are append-only. Each POST inserts a row, so a context's history (`pending` then `success`) is kept, as on GitHub. Generate the migration with `bun db:generate`; never hand-edit drizzle SQL.

Cap: 1000 statuses per `(repository, sha, context)`, as GitHub does. Over the cap, answer 422. (Claude's call, matching GitHub.)

## Fork pull requests

A status belongs to the repository it was posted to. A fork's head commit can carry statuses in two places: the fork, where CI that builds the fork posts, and the base repository, where the head is reachable through `refs/pull/<n>/head` (0033) and where the mirror bot posts.

- POST works on either repository, for any sha that exists in it.
- Everything that shows a pull request's checks (merge panel, PR Commits tab, `statusCheckRollup` on a PR's commits) reads both: the base repository's and the head repository's statuses for the head sha, merged.
- When the same context exists in both, the newest row wins, the same rule as within one repository. (Claude's call.)
- Fork statuses are included only when the viewer can read the fork. A deleted fork contributes nothing.
- Outside a pull request (a repository's commit list, the commit page, `commits/:ref/status`), a repository shows only its own statuses, as on GitHub.
- For a same-repository pull request both are the same repository, so this reduces to one read.

## Combined state

Take the newest row per context for the sha. Then:

- `failure` if any of them is `failure` or `error`
- else `pending` if any is `pending`
- else `success`

A sha with no statuses has combined state `pending` and an empty list in REST, as on GitHub, and a null `statusCheckRollup` in GraphQL.

## API

One service (in `apps/api/src/resources/`, alongside the other resources) holds create, list history, and combined status. Both surfaces below call it; the GitHub layer only translates (per 0040).

### GitHub-compatible REST, under `/api/v3`

- `POST repos/:owner/:repo/statuses/:sha`
  - Body: `state` (required), `target_url`, `description`, `context`.
  - `sha` must be a full commit sha that exists in the repository. Unknown sha, bad state or too-long description: 422 in GitHub's error shape.
  - Requires write access to the repository, and the key's scopes via `requireWriteScope` (`repo`, or `public_repo` for a public repository).
  - Returns 201 with the status in GitHub's shape: `id`, `node_id`, `url`, `state`, `description`, `target_url`, `context`, `avatar_url`, `creator`, `created_at`, `updated_at`.
- `GET repos/:owner/:repo/commits/:ref/statuses`: every status for the commit, newest first, paginated like other list endpoints.
- `GET repos/:owner/:repo/commits/:ref/status`: the combined status: `state`, `sha`, `total_count`, `statuses` (newest per context), `repository`, `commit_url`, `url`.
- `ref` may be a sha, a branch or a tag (resolved with the existing revision resolver, branch before tag before sha). So `commits/main/status` works.
- Reads need read access only; anonymous for public repositories.
- `statuses_url` in `toPullRest` already points at the POST path; it starts resolving once this lands.

### Native REST

- `POST` and `GET /api/repositories/:username/:slug/statuses/:sha`, plus a combined-status read, on the same service, so they appear in the OpenAPI document and in the web app's generated `v1.d.ts`. The exact native paths follow the existing controller's conventions; builder's call.

### GraphQL

- `CommitResolver.statusCheckRollup` (`apps/api/src/github/graphql/resolvers/pull-request/pull-request.resolver.ts`) returns the rollup for `commit.oid`, or null when there are no statuses.
- `StatusCheckRollup.state` is the combined state in GitHub's uppercase enum.
- `contexts` lists one `StatusContext` per context (the newest row), never a `CheckRun`. Fill the existing placeholder types in `apps/api/src/github/graphql/types/placeholders.type.ts`.
- `StatusContext` node ids use GitHub's `SC_` prefix with the Ghost id.
- The gh capture fixtures and the schema conformance test get updated.
- Drop the checks bullet under "Known differences" in `apps/docs/content/docs/github-cli/index.mdx`.

## Event and webhook

- New event `commit_status.created` in `EventPayloads` (`apps/api/src/lib/events/events.ts`), carrying the status id. Published in the same transaction as the insert, through the outbox (0029).
- Added to `webhookEvents` (`apps/api/src/lib/webhooks/webhooks.ts`), so endpoints can subscribe.
- One line in `formats/message.ts` for Slack, Discord, Google Chat and Teams: the context, state, description and a link.
- Because statuses are append-only, `created` covers every change; there is no `updated` event.

## Web

### Pull request merge panel

`apps/web/src/app/[username]/[repo]/pull/[number]/merge-panel.tsx`. Chosen layout: problems first, passing folded (option C in the mockup).

- A checks box between the reviewer list and the "no conflicts" line, shown only when the head commit has statuses.
- Failing (`failure`, `error`) and pending checks each get a row: state icon, context, description, and a Details link to `target_url` when set.
- Passing checks fold into one line ("6 successful checks") with a toggle that expands them into the same rows.
- All passing: just the one green line.
- Informational only: the merge button stays enabled whatever the checks say.
- Data: the combined status of the pull request's head sha, across base and head repositories (see Fork pull requests).
- Merged and closed pull requests keep showing the box, for their final head sha. The box therefore sits outside the open-state branch of the component, above the merged or closed line. Statuses on the merge commit (Railway deploys on `main`) show on the commit page and in the commit list, not here.

### Commit lists

`apps/web/src/components/repositories/commit-list.tsx`, used by the repository commits page and the pull request Commits tab.

- A combined-state icon left of the Verified badge: green check, red cross, or amber dot. No statuses, no icon.
- Hovering the icon shows the contexts, in the same rows as the merge panel.
- Statuses for a page of commits come from one batched lookup, not a query per commit, the same way commit verification is attached to the list today.

### Commit page

- The commit detail page (`/commit/:sha`) gets the same checks box as the merge panel. (Claude's call.)

### Freshness

- Nothing live. New statuses appear on the next page load or `router.refresh()`.

## Decided

- GitHub's Statuses API shape, append-only rows, 1000-per-context cap, 140-character description.
- `commit_status.created` is the only event.
- Ghost answers 422 for an unknown sha; retrying is the caller's job.
- Statuses only; check runs are #79.
- Merge panel layout C; commit list icon with hover; no live updates.
- Fork pull requests show statuses from both the base and the head repository.
- Merged and closed pull requests keep showing their checks.

## Left to the builder

- Id prefix, file and module layout, native route paths.
- Exact icon components and copy, within the existing UI kit.
- Pagination details for the history endpoint, matching existing list endpoints.
- Test layout, following the existing integration and capture specs. The combined-state rule needs its own unit test.
