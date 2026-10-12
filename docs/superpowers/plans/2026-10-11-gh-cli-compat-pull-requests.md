# gh pr: implementation plan (#114)

Bare plan: what to build and where. Same shape as milestone 2 (#112): GraphQL and REST over the existing `PullRequestsService`, no new domain logic.

## 0. Capture first

Add `gh pr` cases to `test/gh-cli.e2e-spec.ts` that call each command (list, view, view --comments, status, create, checkout, diff, merge, ready, close, edit), even before they pass. Push; CI's `gh-capture` artifact gives the exact GraphQL documents and REST routes. Commit them into `test/fixtures/gh-capture/` (README has the commands). `src/github/gh-capture.spec.ts` then lists every missing field and route: that list is the work. Everything below is the expected shape; the capture is the truth.

## 1. Data already there

- `pull_request`: `issueId`, `state` (open/closed/merged), `draft`, `baseRepositoryId`, `baseRef`, `headRepositoryId`, `headRef`, `headSha`, `mergeCommitSha`, `mergedAt`
- `pull_request_review` (+ review state enum), review comments
- `PullRequestsService`: `createPullRequest`, `getPullRequests`, `getPullRequest`, `getCommits`, `getFiles`, `streamPatch`, `compare`, `mergePullRequest(method)`, `updatePullRequest`, `closePullRequest`, `setDraft`
- Ghost's own routes: `apps/api/src/resources/pull-requests/pull-requests.controller.ts`
- Gap: no reopen for pull requests (`reopenIssue` throws `PullRequestReopenError`). Add `PullRequestsService.reopenPullRequest` (open, not merged, head ref still exists) or answer `gh pr reopen` with GitHub's 422.

## 2. GraphQL (`src/github/graphql/`)

- `types/pull-request.type.ts`: grow `PullRequestNode` to what the capture asks. Expected: `state` incl. `MERGED`, `merged`, `mergedAt`, `isDraft`, `baseRefName`, `headRefName`, `headRefOid`, `baseRepository`, `headRepository`, `headRepositoryOwner`, `isCrossRepository`, `maintainerCanModify`, `mergeable` (`MERGEABLE`/`CONFLICTING`/`UNKNOWN`), `mergeStateStatus`, `reviewDecision`, `additions`, `deletions`, `changedFiles`, `files`, `commits` (+ `commits(last:1)` for `statusCheckRollup`), `reviews`, `latestReviews`, `reviewRequests`, `autoMergeRequest` (null), `mergeCommit`, `potentialMergeCommit`.
- Name every new GitHub type exactly (`PullRequestReview`, `PullRequestCommit`, `Commit`, `PullRequestChangedFile`, `StatusCheckRollup`, `ReviewRequest`...); `schema-conformance.spec.ts` checks names, types and nullability against `@octokit/graphql-schema`.
- `lib/github/nodes.ts` `toPullRequestNode`: read `pull_request` (state, draft, refs, mergedAt) instead of IssueDTO alone; drop the `ponytail` that reads merged as `CLOSED`. `getPullRequest` already returns this; select it rather than reshape where possible (mapper exception rules as in the spec).
- `resolvers/pull-request/pull-request.resolver.ts`: field resolvers for the heavy fields (`files`, `commits`, `reviews`, `additions/deletions` via `getFiles`/`getCommits`), each behind a per-request DataLoader in `lib/github/loaders.ts` so `gh pr list` does not N+1.
- `statusCheckRollup`: `null` / empty until #61 (commit statuses). `reviewDecision`: derive from latest review per reviewer (APPROVED / CHANGES_REQUESTED / REVIEW_REQUIRED or null).
- `repository.pullRequests(states, headRefName, baseRefName, first, after, orderBy, labels)` connection over `getPullRequests` (extend its filters if `gh pr list --head/--base` needs them).
- `repository.pullRequest(number)` already resolves via `issueOrPullRequest`; add the direct field.
- `search(type: ISSUE)` with `is:pr`: `search.resolver.ts` returns empty for `isPullRequest === true` today; route it to `getPullRequests` (`gh pr list --search`, `gh pr status`).
- `viewer.pullRequests` / search `author:@me`, `review-requested:@me` for `gh pr status`.
- Mutations (`resolvers/` new `pull-request-mutations`): `createPullRequest`, `updatePullRequest` (title, body, base), `closePullRequest`, `reopenPullRequest`, `mergePullRequest` (`mergeMethod` MERGE/SQUASH/REBASE, `commitHeadline`, `commitBody`, `expectedHeadOid`), `markPullRequestReadyForReview`, `convertPullRequestToDraft`, plus the label/assignee mutations already served (they take `PR_` ids: let `decodeNodeIdAs` accept PullRequest where Labelable/Assignable). `requireWriteScope` on each, as in `issue-mutations.resolver.ts`.
- Node ids: `PR_` exists. `node(id:)` dispatch must return `PullRequestNode`. Reviews need a prefix (`PRR_`) in `node-id.ts`.

## 3. REST (`src/github/rest/pulls/`, new module like `rest/issues/`)

- `GET/POST /repos/:o/:r/pulls`, `GET/PATCH /pulls/:number`, `PUT /pulls/:number/merge`, `GET /pulls/:number/files`, `GET /pulls/:number/commits`, `GET /pulls/:number/reviews` (if captured).
- `GET /pulls/:number` with `Accept: application/vnd.github.diff` / `.patch` answers the raw text from `streamPatch` (`gh pr diff`). Branch on the Accept header in the controller.
- `toPullRest` in `lib/github/rest.ts`: GitHub's `pull-request` schema (`head`/`base` objects with `ref`, `sha`, `repo`, `label`; `merged`, `mergeable`, `merged_at`, `draft`, `diff_url`...). Reuse `toUserRest`, `toLabelRest`, the `RestContext` and `GithubIssuesService.issues` patterns; `numeric_id` exists on `issue` (use it for the PR `id` as GitHub's PR id differs from the issue id; decide, or add `numeric_id` to `pull_request`).
- Paging and `Link` via `pageOf` / `GithubIssuesService.link`; errors through `GithubRestFilter` (merge conflicts → 405 "Pull Request is not mergeable", head changed → 409, as GitHub).
- `CommentsController` (`issues/:number/comments`) already serves PR comments (`gh pr comment`).

## 4. `gh pr checkout`

Needs nothing new beyond fields: `gh` reads `headRefName`, `headRepository { name }`, `headRepositoryOwner { login }`, `isCrossRepository`, `maintainerCanModify` and the clone URL, then runs `git fetch`. Same-repo works over existing git transport; forks need `headRepository.url`/clone URL to resolve to the fork, which `toRepositoryNode` already builds. Ghost also exposes `refs/pull/N/head`? Check `pullRefsBlocked`; if served, `gh` fetches `refs/pull/N/head` for cross-repo PRs.

## 5. Docs

`apps/docs/content/docs/github-cli/index.mdx`: supported `gh pr` commands, served types/routes, differences (no checks until #61, no auto-merge, no merge queue, review requests if absent). Drop "Pull requests" from "Not yet supported".

## Order

capture → `toPullRequestNode` state fix + scalar fields → `pullRequests` connection + `is:pr` search (`gh pr list/status`) → heavy fields + loaders (`gh pr view`) → mutations (`create/merge/close/reopen/ready/edit`) → REST pulls + diff (`gh pr diff`, `gh api`) → checkout check → docs. Re-run the capture after each step; the spec's failures shrink to zero.
