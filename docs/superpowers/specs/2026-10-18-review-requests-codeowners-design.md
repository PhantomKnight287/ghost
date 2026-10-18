# Review requests and CODEOWNERS

Issue: none yet; split out of branch protection (#17 on Ghost, #62 on GitHub) on 2026-10-18. File one before work starts.

## Intent

Branch protection is going to be built as GitHub's repository rulesets, and one of their rules is "require review from code owners". CODEOWNERS on GitHub works mainly by requesting reviews automatically, and Ghost has no review requests at all: REST `requested_reviewers` is always `[]`, GraphQL `reviewRequests` is always empty, and nobody can ask a person or team to review a pull request. So this work adds review requests first and CODEOWNERS on top.

Copy GitHub as closely as possible. It is the industry standard, its documentation doubles as ours, and people moving from GitHub should find the same behaviour. Where this document is silent, do what GitHub does.

## Goals

1. People can request reviews from users and teams on a pull request, remove the requests, and re-request after a review.
2. Requested reviewers are notified (inbox and email), see the request on their dashboard, and can find it with `review-requested:@me`.
3. A CODEOWNERS file assigns owners to paths. Owners of changed files are requested automatically.
4. Ownership shows on the blob view and in the PR files tab. Errors in the CODEOWNERS file are shown on the file itself and through the API.
5. GitHub tooling works unchanged: REST, GraphQL, and `gh pr create --reviewer`, `gh pr edit --add-reviewer/--remove-reviewer`, `gh pr status`, `gh pr view`.

## Non-goals

- The "require review from code owners" ruleset rule. It ships with rulesets. This work must leave room for it: requests and reviews record whether they came from a code owner.
- Team auto-assignment. Deferred, see the last section; file it as its own issue once this lands.
- Editing CODEOWNERS in the browser with live errors. Comes with the web file editor (#70).
- Suggested reviewers (GitHub's blame-based suggestions).

## Anti-goals

- Any REST or GraphQL shape that differs from GitHub's where GitHub defines one.
- A CODEOWNERS file that GitHub reads one way and Ghost another. Same syntax, same matching, same "last match wins".
- Silent CODEOWNERS failures. A line that can never request anyone must show as an error somewhere a person will see it.

## Part 1: review requests

### Who

- **Requesting and removing:** triage role and up (`atLeast(role, 'triage')`, 0021). A pull request author without triage cannot request, including fork contributors. This matches GitHub.
- **Requestable users:** anyone with **explicit** read access, except the pull request's author: the owner, collaborators, members of teams on the repository, and organization members through the base permission. Public visibility alone does not count, so a triager cannot page arbitrary users of the instance. This matches GitHub, where only collaborators can be requested.
- **Requestable teams:** org repositories only. Any team of the owning organization that has a `repository_team` row on the repository (any role).
- Requests are allowed on drafts and on open pull requests. Closed or merged requests refuse them (422).
- Requesting someone already pending is a no-op. GitHub caps one call at 15 reviewers; copy that (422 above it).

### Lifecycle

- A request is pending until it is removed or answered.
- Any submitted review by a requested user (approve, request changes, comment) clears that user's request. A pending (unsubmitted) review does not.
- When a member of a requested team submits a review, the team's request is cleared and the review records the team it was on behalf of (`onBehalfOf`). A member of several requested teams clears all of them. If the member was also requested directly, that clears too.
- Re-request: after a reviewer has reviewed, a request can be made again. This is an ordinary new request; the UI shows it as the ↻ button beside the reviewer.
- Each add and each removal writes a timeline event and an outbox event.

### Data

New table `pull_request_review_request` in `packages/db/src/schema/pull-requests.ts`. snake_case columns (0030), timestamptz (0018):

- `id`, prefixed like other tables.
- `pull_request_id` (or the issue id, following what `pullRequestReview` keys on), cascade on delete.
- `reviewer_user_id` nullable, `reviewer_team_id` nullable; exactly one set (check constraint). Cascade on delete.
- `requested_by_id`: the actor, set null on delete. For CODEOWNERS requests, the actor whose action triggered them (who opened the PR, marked it ready, or pushed).
- `as_code_owner` boolean, default false.
- `created_at`.

- `cleared_at` nullable, and `cleared_reason`: `reviewed` or `removed`. A cleared request keeps its row, so CODEOWNERS can tell who was ever requested on this pull request (see Automatic requests). Pending means `cleared_at is null`.

Partial unique indexes on (pull request, user) and (pull request, team) where `cleared_at is null`. A re-request inserts a new row.

New join table `pull_request_review_on_behalf_of` (`review_id`, `team_id`), cascade on both. A reviewer who belongs to several requested teams clears **all** of them, and the review lists each, which is what GitHub's `onBehalfOf` connection holds.

`issue_event_type` gains `review_requested` and `review_request_removed`. `issue_event` gains `requested_reviewer_username` and `requested_team_slug` text columns (text, like `assigneeUsername`, so the timeline survives deletion).

`notification_reason` gains `review_requested`.

Generate migrations with `bun db:generate`; never hand-edit drizzle SQL.

### Events

Add to `EventPayloads` in `apps/api/src/lib/events/events.ts`:

- `pull_request.review_requested`: `{ issueId, requestedUserId? , requestedTeamId? }`
- `pull_request.review_request_removed`: same shape.

Webhooks send them as GitHub's `pull_request` action `review_requested` / `review_request_removed`, with `requested_reviewer` or `requested_team` in the payload. A request removed because the reviewer submitted a review does **not** fire `review_request_removed`, matching GitHub (the review event covers it).

### Notifications

- A user request notifies that user with reason `review_requested`, inbox and email, and subscribes them to the thread.
- A team request notifies every member of the team except the actor and the author.
- Email uses the existing thread template; subject line follows GitHub's ("@x requested your review on: ...").

### API

Ghost's own API, beside the existing pull request routes:

- `GET /repositories/:owner/:repo/pulls/:number/requested-reviewers`
- `POST` same path with `{ users: string[], teams: string[] }` (usernames, team slugs)
- `DELETE` same path with the same body

Copy the shape of the issue assignees routes (`issues.controller.ts` `PUT :number/assignees`) for naming and validation.

GitHub layer:

- REST `GET/POST/DELETE /repos/{owner}/{repo}/pulls/{n}/requested_reviewers` with `reviewers` and `team_reviewers`, GitHub's response shapes. 422 for unknown or ineligible reviewers, as GitHub.
- REST `requested_reviewers` and `requested_teams` on the pull request object (`toPullRest` in `lib/github/rest.ts`) read the table.
- GraphQL `PullRequest.reviewRequests` (`pull-request.resolver.ts`, currently `sliceConnection([])`) returns `ReviewRequest` nodes with `requestedReviewer` (User or Team) and `asCodeOwner`.
- GraphQL mutation `requestReviews(input: { pullRequestId, userIds, teamIds, union })`. `union: true` adds; otherwise it replaces the set, as GitHub. This is what `gh pr edit --add-reviewer/--remove-reviewer` and `gh pr create --reviewer` send; check the exact mutations `gh` uses and implement those.
- `PullRequestReview.onBehalfOf` returns the team, if any.
- `reviewDecision` stays as it is. On GitHub it depends on branch protection, so it changes with rulesets.
- Search: `review-requested:<user|@me>` matches a direct request or a request to a team the user is in; `user-review-requested:` matches direct only; `team-review-requested:org/team`. `lib/github/issue-search.ts` already parses `review-requested`; wire it to the table. `gh pr status` uses this.
- Webhook formats in `lib/webhooks/formats/` gain the two actions.

### Web

- **PR sidebar, Reviewers section**, above Assignees. Picker modelled on `components/issues/assignee-picker.tsx`, listing requestable users and teams. Each row shows the reviewer's state: pending request, approved, changes requested, commented. Reviewers who reviewed without being requested also appear, as on GitHub. ↻ re-request beside anyone who has reviewed. A code-owner request shows a shield icon with "Code owner".
- Only people with triage+ see the picker; everyone sees the list.
- **Timeline:** "@a requested a review from @b", "@a removed the request for review from @b", team variants.
- **Pulls list:** a "Review requested" filter (`review-requested:@me`), and a reviewer column state like GitHub's ("Review required", "Approved", "Changes requested") is optional, builder's call.
- **Dashboard:** a "Review requests" list of open pull requests requesting the viewer, directly or through a team.

## Part 2: CODEOWNERS

### Which file

The first that exists, in this order, on the relevant ref:

1. `.ghost/CODEOWNERS` (Ghost addition)
2. `.github/CODEOWNERS`
3. `CODEOWNERS`
4. `docs/CODEOWNERS`

Only that file is used. Files over 3 MB are ignored (treated as no file), as on GitHub.

For a pull request, the ref is the **base branch**, so a pull request cannot grant itself owners. For the blob view, it is the ref being viewed.

### Syntax and matching

Exactly GitHub's:

- One rule per line: a pattern, then zero or more owners, whitespace separated. `#` starts a comment; `\#` is a literal `#`. Blank lines ignored.
- Patterns follow gitignore rules, except: no `!` negation, no `[ ]` character ranges. Those lines are errors.
- The **last** matching line wins. A matching line with no owners means the path has no owners.
- Owners: `@user`, `@org/team`, or an email address. An email resolves to the user with that verified email.
- An owner must have **write** access to the repository. A team must belong to the repository's organization and have write access through `repository_team`. Owners that fail this are ignored for requests and reported as errors.

Write the parser and matcher as one pure module (`lib/codeowners/` or similar) that takes the file text and returns rules plus syntax errors, and a function that maps a path to its owners. Resolving owners against users, teams and access is a separate step. Test the matcher against GitHub's documented examples. Match patterns with the `ignore` package (gitignore semantics), not hand-written glob code.

### Errors

One check produces a list of `{ line, column, kind, source, suggestion, message, path }`, GitHub's `codeowners/errors` shape. Kinds include: invalid pattern, invalid owner format, unknown owner, owner without write access, unknown team, team without write access.

Shown in three places:

1. **Blob view of the active CODEOWNERS file:** a banner above the file, "This CODEOWNERS file contains N errors", and a gutter marker plus underline on each bad line with the message on hover. Example messages: `Unknown owner on line 4: make sure @alcie exists and has write access to the repository`, `Invalid pattern on line 7: [ ] ranges are not supported`.
2. **Blob view of an inactive CODEOWNERS file** (e.g. `.github/CODEOWNERS` while `.ghost/CODEOWNERS` exists): a banner "Ignored: .ghost/CODEOWNERS takes precedence". Ghost addition. Errors are not checked for an ignored file.
3. **REST** `GET /repos/{owner}/{repo}/codeowners/errors?ref=<ref>`, default ref the default branch. 404 when there is no CODEOWNERS file, as GitHub.

### Automatic requests

Owners of the pull request's changed files are requested, with `as_code_owner = true`:

- when a pull request is opened, unless it is a draft;
- when a draft is marked ready for review;
- when a push to an open, non-draft pull request changes files whose owners have **never** been requested on this pull request (only new owners are added; owners removed by the push are not unrequested).

"Never requested" counts every row in `pull_request_review_request`, pending or cleared. An owner who already reviewed is not re-requested by a later push, and a code-owner request someone removed by hand does not come back.

Never request the pull request's author, an owner who is already pending, or an owner who fails the write-access check. A team owner is requested as the team. "Changed files" means the pull request's diff against its merge base, the same set the files tab shows.

These run off the existing outbox events (`issue.opened` for pull requests, `pull_request.ready_for_review`, `pull_request.synchronized`) or inline in the same code paths; builder's call. Either way, a failure to read or parse CODEOWNERS must never fail the pull request operation itself. The requests then follow Part 1: timeline, notifications, webhooks, all as if the actor had requested them.

A manual request for someone who is also a code owner is not a code-owner request. Removing a code-owner request is allowed, as on GitHub.

### Showing ownership

- **Blob view:** a shield icon in the file header, "Owned by @alice and @org/team" on hover, from the CODEOWNERS file on the viewed ref. No icon when the file has no owners.
- **PR files tab:** the same icon per file header, from the base branch's CODEOWNERS, with a marker when the viewer is one of the owners.

## Testing

- Unit: the parser and matcher, including last-match-wins, ownerless lines, escapes, every error kind, and GitHub's documented examples.
- Integration/e2e: request and remove (users and teams), permissions (read-only and author refused), clearing on review and on team-member review with `onBehalfOf`, notifications, timeline, webhooks, search `review-requested:@me`, `codeowners/errors`, automatic requests on open, ready and push, and the file precedence order.
- gh-cli e2e: `gh pr create --reviewer`, `gh pr edit --add-reviewer/--remove-reviewer`, `gh pr status` showing a requested review.
- Run the full API suite only against a throwaway Postgres, never the dev database.

## Builder's calls

- Table and column naming beyond what is stated; id prefixes.
- Outbox consumer vs inline for automatic requests.
- Exact UI layout, within GitHub's patterns.
- Reviews do not record whether the reviewer was a code owner. The future ruleset rule re-checks CODEOWNERS on the base branch at merge time, as GitHub does.
- The reviewer state column in the pulls list.

## Deferred: team auto-assignment

GitHub lets a team replace a team review request with specific members. To file as an issue after this lands:

- Per-team settings: enabled, algorithm (round robin or load balance), number of reviewers, members to skip, "don't notify the whole team", "count existing requests".
- Round robin needs a cursor per team; load balance counts each member's requests over a recent window.
- On a team request, pick the members, request them on behalf of the team, and drop or keep the team request per the settings.
- Team settings UI on the organization team page.
