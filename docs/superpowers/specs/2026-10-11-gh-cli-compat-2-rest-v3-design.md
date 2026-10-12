# GitHub REST v3 for issues, comments and labels

Issue: [#57](https://github.com/PhantomKnight287/ghost/issues/57). Milestone 2 of [the compatibility spec](2026-10-09-gh-cli-compat-design.md).

## Goal

Serve GitHub's REST v3 routes for issues, issue comments and labels from the existing `IssuesService`, shaped closely enough that `gh label …`, `gh api … --paginate` and typed SDKs (octokit, go-github, PyGithub, Terraform's GitHub provider) work against Ghost. Every route, parameter, status code and required response field below was checked against GitHub's OpenAPI description (`github/rest-api-description`, `descriptions/api.github.com/api.github.com.json`).

## Integer ids: `numeric_id`

GitHub's REST `id` (and GraphQL `databaseId`) is an int64. Typed SDKs decode it as one: go-github fails a whole response on a string `id`, and its comment methods take `commentID int64`, so comment routes keyed by id are unreachable without an integer. Clients also key their own state on `id`, so `null` everywhere makes every object collide.

`user`, `organization`, `repository`, `issue`, `issue_comment` and `label` each gain:

```ts
numericId: bigint('numeric_id', { mode: 'number' }).generatedAlwaysAsIdentity().notNull().unique()
```

- The primary key is unchanged. Nothing writes the column, nothing references it, and Ghost's own API does not return it. A schema comment on each says it exists for the GitHub compatibility layer.
- Postgres numbers existing rows when the column is added.
- On `user`, Better Auth never inserts the column and `parseUserOutput` filters it out of its responses, so its flows are unaffected.
- `issue_comment.github_id` already exists and means the original GitHub id of an imported comment. The two are unrelated.
- The compat layer sends `numeric_id` as REST `id` and GraphQL `databaseId` on every type that has one, replacing today's `null`.

## Routes

All under `/api/v3/repos/:owner/:repo`, tagged `GitHub compatibility` in the OpenAPI document.

| Route | Answers |
| --- | --- |
| `GET /issues` | 200 `issue[]` + `Link`. Filters `state`, `labels`, `assignee` (`none`, `*`, login), `creator`, `sort`, `direction`, `since`. `milestone`, `mentioned`, `type`, `issue_field_values` are ignored. Includes pull requests. |
| `POST /issues` | 201 `issue` + `Location` |
| `GET /issues/:number` | 200 `issue` |
| `PATCH /issues/:number` | 200 `issue` |
| `GET /issues/:number/comments` | 200 `issue-comment[]` + `Link`, `since` |
| `POST /issues/:number/comments` | 201 `issue-comment` + `Location` |
| `GET /issues/comments` | 200 `issue-comment[]` + `Link`, `sort` (`created`, `updated`), `direction`, `since` |
| `GET /issues/comments/:comment_id` | 200 `issue-comment` |
| `PATCH /issues/comments/:comment_id` | 200 `issue-comment` |
| `DELETE /issues/comments/:comment_id` | 204 |
| `GET /issues/:number/labels` | 200 `label[]` + `Link` |
| `POST /issues/:number/labels` | 200 `label[]` (all labels on the issue) |
| `PUT /issues/:number/labels` | 200 `label[]` |
| `DELETE /issues/:number/labels` | 204 |
| `DELETE /issues/:number/labels/:name` | 200 remaining `label[]`; 404 when the label is not on the issue |
| `POST /issues/:number/assignees` | 201 `issue` (no `Location`); at most 10 logins |
| `DELETE /issues/:number/assignees` | 200 `issue` |
| `GET /issues/:number/assignees/:assignee` | 204, or 404 |
| `GET /assignees` | 200 `simple-user[]` + `Link` |
| `GET /assignees/:assignee` | 204, or 404 |
| `GET /labels` | 200 `label[]` + `Link` |
| `POST /labels` | 201 `label` + `Location` |
| `GET /labels/:name` | 200 `label` |
| `PATCH /labels/:name` | 200 `label`; body `new_name`, `color`, `description` |
| `DELETE /labels/:name` | 204 |

### Request bodies

- `POST`/`PATCH /issues` accept `title` (string or integer), `body`, `labels` (strings or `{ name }`), `assignees`, the deprecated `assignee`, `state`, `state_reason` (`completed`, `not_planned`, `duplicate`, `reopened`), `duplicate_issue_id` and `milestone`. `milestone` other than `null` answers 422. `state_reason` and `duplicate_issue_id` are accepted and not stored.
- `POST` and `PUT /issues/:number/labels` accept `{ labels: string[] }`, `string[]`, `{ name }[]` and `{ labels: { name }[] }`. GitHub's `PUT` also takes a bare string; Ghost's JSON parser is strict and refuses it, listed as a difference.

### Pagination

`page` and `per_page` (default 30, clamped to 1..100), offset-based. `Link` carries `first`, `prev`, `next` and `last` with page numbers; `last` comes from the list's count. go-github and PyGithub read `page` out of `Link` as an integer, so a cursor there would end their loops after one page. GraphQL keeps keyset paging.

- `IssuesService.getIssues` takes a second, optional `IssueListOptions` (`offset`, `includePullRequests`, `since`, `assigned`) that Ghost's own controller never passes, so its DTO and API are unchanged.
- `IssuesService.getCommentPage` pages comments in SQL, for one issue or the whole repository, and selects `numeric_id` with the issue number each belongs to.
- Labels are listed whole by `listLabels` and sliced in the controller.
- Deep offsets scan the rows they skip; both are marked with `ponytail:` comments.

### Out of milestone 2

Listed on the compatibility page with the reason:

- Lock and unlock: Ghost has no locking ([#111](https://github.com/PhantomKnight287/ghost/issues/111)); `locked` is `false`.
- Milestones, issue types, sub-issues and `parent`, dependencies, `relates_to`, issue field values, GitHub's issue suggestions, comment pins, label archiving: no Ghost feature behind them.
- Reactions, issue events and timeline: other domains.
- `/issues`, `/user/issues`, `/orgs/:org/issues`: cross-repository lists with no service behind them.

## Response shapes

Mappers live in `apps/api/src/lib/github/rest.ts` under the spec's mapper exception, each with a one-line reason: `IssuesService` hands back Ghost's DTOs and the REST shape renames, nests and adds URLs to them. `restUser` in `users.controller.ts` moves there and is shared.

A list loads every user its page mentions (authors, assignees, closers) in one query by username, and the `merged_at` of its pull requests in one query by issue id.

### `simple-user`

`login`, `id`, `node_id`, `avatar_url`, `gravatar_id` (`''`), `url`, `html_url`, `type` (`User` or `Organization`), `site_admin` (`false`), and the URL templates GitHub requires (`followers_url`, `following_url`, `gists_url`, `starred_url`, `subscriptions_url`, `organizations_url`, `repos_url`, `events_url`, `received_events_url`) in GitHub's form under `/api/v3/users/:login`. Nothing serves most of those; typed decoders expect the keys.

### `issue`

| Field | Source |
| --- | --- |
| `id`, `node_id`, `number`, `title`, `body` | `numeric_id`, `I_…` (`PR_…` for a pull request), the issue |
| `state`, `closed_at`, `created_at`, `updated_at` | the issue |
| `state_reason` | `completed` when closed, else `null` |
| `user`, `assignees`, `assignee`, `closed_by` | `simple-user`; `assignee` is the first assignee or `null` |
| `labels` | `label[]` |
| `comments` | comment count |
| `url`, `repository_url`, `labels_url`, `comments_url`, `events_url`, `timeline_url` | API origin |
| `html_url` | web origin, `/issues/:n` or `/pull/:n` |
| `locked`, `active_lock_reason`, `milestone` | `false`, `null`, `null` |
| `author_association` | `OWNER` when the author owns the repository, else `NONE`, as in GraphQL |
| `pull_request` | pull requests only: `url` (`/api/v3/repos/:o/:r/pulls/:n`, served from milestone 3), `html_url`, `diff_url`, `patch_url`, `merged_at` |
| `draft` | pull requests only |

Not sent, as GitHub sends them only under other media types or routes: `body_html`, `body_text`, `repository`, `reactions`, `sub_issues_summary`, `type`, `pinned_comment`, `issue_field_values`, `performed_via_github_app`.

### `label`

`id`, `node_id` (`LA_…`), `url` (`/labels/:name`, encoded), `name`, `color`, `description`, `default` (`false`), `archived_at` and `archived_by` (`null`).

### `issue-comment`

`id`, `node_id` (`IC_…`), `url` (`/issues/comments/:id`), `issue_url`, `html_url`, `body`, `user`, `created_at`, `updated_at`, `author_association`. `html_url` keeps the web app's anchor (`#issuecomment-<Ghost id>`) so the link opens on the comment.

## Writes and permissions

- Each route resolves its repository through `RepositoryResolver.repository`, as `ReposController` does: a private repository answers 404 to anonymous callers and to tokens without `repo`.
- Each write calls `requireWriteScope`. A missing scope answers 403 with `X-Accepted-OAuth-Scopes`.
- GitHub silently drops `labels` and `assignees` sent by someone without push access when creating or editing an issue. The compat layer drops them unless the viewer has triage access or above, so the service's permission checks are not reached with values GitHub would ignore.
- Labels that do not exist are created with color `ededed` and no description before they are set, on `POST /issues`, `PATCH /issues/:number`, `POST` and `PUT /issues/:number/labels`. Confirmed against github.com on 2026-10-11.
- Add and remove read the current set and call `setIssueLabels` / `setIssueAssignees`. Two concurrent adds can lose one, as with the GraphQL mutations; marked `ponytail:`.
- `state` only calls `closeIssue` / `reopenIssue` when it changes, so closing a closed issue answers 200 as on GitHub. The GraphQL `updateIssue` gets the same fix.
- A comment route loads the comment by `numeric_id` with its issue's number and repository; a comment from another repository answers 404. Only the comment's author can edit it, as in Ghost (GitHub also lets maintainers).
- Ghost lets any user be assigned. `GET /assignees` lists the people with access (owner, accepted collaborators, organization members); `GET /assignees/:assignee` and `GET /issues/:number/assignees/:assignee` answer 204 for any existing user. An unknown login in a write answers 422 on `assignees`.
- `POST /issues/:number/assignees` from someone who cannot triage is ignored and answers the unchanged issue, as GitHub documents. The label routes on an issue leave the permission check to `setIssueLabels`.

## Errors

`GithubRestFilter` adds `status` as a string to every body, as GitHub now does (`{"message":"Not Found","documentation_url":"…","status":"404"}`), and answers validation failures in GitHub's `validation-error` shape with 422:

| Ghost | GitHub |
| --- | --- |
| `LabelAlreadyExistsError` | 422, `errors: [{ resource: "Label", field: "name", code: "already_exists" }]` |
| `ValidationPipe` failure | 422, `errors: [{ field, code: "invalid", message }]`; class-validator starts each message with the field |
| unknown assignee, bad label body, milestone | 422 on `assignees`, `labels`, `milestone` |
| `NotCommentAuthorError` | 403 |
| `PullRequestReopenError` | 422 |
| a path number or comment id that is not an integer | 404 |
| any 404 | `Not Found` |

`documentation_url` stays the generic `https://docs.github.com/rest`.

## Testing

1. **Units.** Mappers on representative rows (a pull request, a null `closed_by`), `Link` building (first, middle, last, single page), `per_page` clamping, label body normalization for every accepted shape, the 422 error shapes.
2. **API e2e** on the throwaway Postgres harness. Anonymous, reader and writer per route; private repository as 404, with and without `repo`. `numeric_id` is an integer on every object and equals GraphQL `databaseId`; sign-up still works. Paging across 35 issues. Pull requests in `GET /issues`. Silent drops for a reader, unknown labels created, add and remove composition with the documented status codes, comment by `numeric_id` including another repository's id, duplicate label as 422 `already_exists`, closing twice.
3. **Real `gh`.** `gh label create/edit/delete/list/clone`, `gh api repos/:o/:r/issues --paginate`, and a comment edit through `gh api`.

## Documentation

`apps/docs/content/docs/github-cli/index.mdx` lists the new routes and `gh label` commands, replaces "`databaseId` and the REST `id` are always `null`", and adds the out-of-scope list and these differences: only a comment's author edits it, `state_reason` is not stored, comment `html_url` anchors use Ghost's id, a bare-string label body is refused, how assignees are checked, `documentation_url` is generic.
