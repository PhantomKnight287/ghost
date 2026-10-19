# Review Requests and CODEOWNERS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users and teams can be requested to review a pull request, by hand or automatically from a CODEOWNERS file, with GitHub's behaviour, API shapes and `gh` support.

**Architecture:** One table of review requests (pending and cleared rows) behind a `ReviewRequestsService` in the pull requests module. Ghost routes, the GitHub REST/GraphQL layer, the review flow and the outbox all go through it. CODEOWNERS is a pure parser/matcher in `lib/codeowners`, plus a `CodeownersService` that loads the file at a ref and resolves owners. A third outbox consumer turns PR open, ready and push events into code-owner requests.

**Tech Stack:** NestJS + drizzle (apps/api), Postgres, vitest (unit `*.spec.ts`, e2e `test/*.e2e-spec.ts`), Next.js + openapi-fetch + next-safe-action (apps/web), `gh` e2e suite.

**Spec:** `docs/superpowers/specs/2026-10-18-review-requests-codeowners-design.md`

**Before Task 1:** file an issue for this work on Ghost (and the GitHub mirror) and reference it in commits and PRs.

## Global Constraints

- Copy GitHub. Where the spec is silent, do what GitHub does.
- Columns are snake_case (0030); timestamps are timestamptz (0018).
- Generate migrations with `bun db:generate` at the repo root. Never hand-edit drizzle SQL.
- Never run the full API suite against the dev database (192.168.1.4). Use a throwaway Postgres + rustfs, as in the `api-e2e-known-failures` recipe.
- Regenerate the web client after API changes with `bun openapi` at the root.
- Requesting/removing needs `triage` (`atLeast(role, 'triage')`). Requestable users need an **explicit** role (`roleOf` in `lib/repositories/access/repository-access.ts`, not public visibility). Teams need a `repository_team` row on the repository. The PR author is never requestable.
- Max 15 reviewers per call (422 above it). Closed or merged pull requests refuse requests (422).
- CODEOWNERS lookup order: `.ghost/CODEOWNERS`, `.github/CODEOWNERS`, `CODEOWNERS`, `docs/CODEOWNERS`. First found wins. Over 3 MB counts as no file.
- A failure reading or parsing CODEOWNERS never fails the pull request operation.
- Code comments, commits and docs are plain English (no caveman). Match the surrounding comment density.

## Review Focus

1. **Outbox retries.** The code-owner consumer can run twice for one event. It must not request twice or error (Task 9 test: handle the same event twice, one row).
2. **Team member who is also the author.** A team request notifies every member except the actor and the author (Task 4 test).
3. **Re-request after review.** Reviewed, then re-requested: a new pending row, the old cleared one kept, and the partial unique index not violated (Task 2 test).
4. **CODEOWNERS on a base branch the viewer cannot see, or a fork PR.** Owners always come from the **base** repository's base ref, never the head (Task 9 test: a fork PR whose head adds a CODEOWNERS file requests nobody from it).
5. **Owner who loses write access after the file was written.** They are skipped for requests and show as an error, not a crash (Task 8 test).

---

### Task 1: Schema

**Files:**
- Modify: `packages/db/src/schema/pull-requests.ts`
- Modify: `packages/db/src/schema/issues.ts` (`issueEventType`, `issueEvent`)
- Modify: `packages/db/src/schema/notifications.ts` (`notificationReason`)
- Create: the generated migration under `packages/db/drizzle/` (via `bun db:generate`)

**Interfaces:**
- Produces:
  - `schema.pullRequestReviewRequest`: `id` (`prq_` prefix), `pullRequestId` → `pull_request.id` cascade, `reviewerUserId` → user cascade (nullable), `reviewerTeamId` → team cascade (nullable), `requestedById` → user set null, `asCodeOwner` boolean default false, `createdAt`, `clearedAt` nullable, `clearedReason` enum `review_request_cleared_reason` (`reviewed`, `removed`) nullable.
    - Check constraint: exactly one of `reviewerUserId` / `reviewerTeamId` is set.
    - Partial unique indexes on (`pullRequestId`, `reviewerUserId`) and (`pullRequestId`, `reviewerTeamId`), each `where cleared_at is null`.
    - Index on `reviewerUserId` and on `reviewerTeamId` for the dashboard and search.
  - `schema.pullRequestReviewOnBehalfOf`: `reviewId` → `pull_request_review.id` cascade, `teamId` → team cascade, primary key on both.
  - `issueEventType` gains `review_requested`, `review_request_removed`. `issueEvent` gains `requestedReviewerUsername` and `requestedTeamSlug` (text, nullable).
  - `notificationReason` gains `review_requested`.

- [ ] **Step 1:** Add the tables, columns and enum values above, each table with a doc comment in the style of its neighbours (what a row is, what pending means).
- [ ] **Step 2:** Run `bun db:generate` at the root. Expected: one new migration with `CREATE TABLE "pull_request_review_request"`, the join table, and `ALTER TYPE ... ADD VALUE` lines.
- [ ] **Step 3:** Run `bun run --filter @ghost/db build` (or the package's typecheck). Expected: no errors.
- [ ] **Step 4:** Commit `feat(db): review requests and on-behalf-of teams`.

---

### Task 2: ReviewRequestsService and Ghost routes

**Files:**
- Create: `apps/api/src/resources/pull-requests/review-requests.service.ts`
- Create: `apps/api/src/resources/pull-requests/review-requests.controller.ts`
- Create: `apps/api/src/resources/pull-requests/dto/review-requests.dto.ts`
- Modify: `apps/api/src/resources/pull-requests/pull-requests.module.ts`
- Modify: `apps/api/src/lib/pull-requests/pull-requests.errors.ts` (new errors)
- Modify: `apps/api/src/lib/events/events.ts` (two event types)
- Modify: `apps/api/src/services/git/repository-access/repository-access.service.ts` (explicit role lookup, if none exists)
- Modify: timeline read in `apps/api/src/resources/issues/issues.service.ts` (select the two new columns)
- Test: `apps/api/test/review-requests.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 1 schema; `PullRequestsService.load(params: PullRequestRef)`; `publishEvent`; `teamSlug(name)` from `lib/organizations/team-slug.ts`; `touchIssue`.
- Produces:
  - `type RequestedReviewers = { users: { id: string; username: string; name: string | null; image: string | null; asCodeOwner: boolean }[]; teams: { id: string; slug: string; name: string; asCodeOwner: boolean }[] }`
  - `ReviewRequestsService.list(params: PullRequestRef): Promise<RequestedReviewers>`, pending only.
  - `ReviewRequestsService.request(params: PullRequestRef & { requesterId: string; users: string[]; teams: string[] }): Promise<RequestedReviewers>`. Authorizes triage, resolves usernames and team slugs, then calls `addRequests`.
  - `ReviewRequestsService.remove(params: same): Promise<RequestedReviewers>`. Clears with reason `removed`.
  - `ReviewRequestsService.addRequests(tx: Executor, args: { pullRequestId: string; issueId: string; repositoryId: string; organizationId: string | null; authorId: string; actorId: string; userIds: string[]; teamIds: string[]; asCodeOwner: boolean }): Promise<{ userIds: string[]; teamIds: string[] }>`. No permission check. Skips the author, ineligible reviewers and pending ones. Returns what it actually added. Writes the `review_requested` timeline event and the `pull_request.review_requested` outbox event per added reviewer.
  - `RepositoryAccessService.explicitRole(repositoryId: string, userId: string): Promise<Role | null>`, `roleOf` without public visibility.
  - Events: `'pull_request.review_requested': { issueId: string; requestedUserId?: string; requestedTeamId?: string }` and `'pull_request.review_request_removed'` with the same shape.
  - Errors (422 via the existing DomainError mapping): `ReviewerNotFoundError(name)`, `ReviewerNotEligibleError(name)`, `TooManyReviewersError()`. Reuse `PullRequestNotOpenError` for closed/merged.
  - Routes on `@Controller('repositories/:username/:repo/pulls')`: `GET/POST/DELETE :number/requested-reviewers`, body `{ users?: string[]; teams?: string[] }`.

- [ ] **Step 1: Write the failing e2e test** `test/review-requests.e2e-spec.ts`, modelled on `test/pull-request-reviews.e2e-spec.ts` (owner, a collaborator with write, a bystander with no grant, a public repo, a `feature` branch PR). Cases:
  - `POST requested-reviewers {users:[collaborator]}` by owner: 201, `users[0].username === collaborator`, `asCodeOwner === false`. Timeline has `review_requested` with `requestedReviewerUsername`.
  - Same request twice: one pending entry.
  - `{users:[bystander]}` on the public repo: 422 (no explicit role).
  - `{users:[owner]}` (the author): 422.
  - 16 users: 422.
  - Bystander calling POST: 403/404, as other triage routes answer.
  - `DELETE` removes it: list is empty; timeline has `review_request_removed`.
  - Re-request after removal: pending again; DB has two rows for that reviewer, one cleared.
  - Org repo: a team with a `repository_team` row is requestable by slug; a team without one is 422.
  - Closed PR: 422.
- [ ] **Step 2:** Run `bunx vitest run --config ./vitest.config.e2e.ts test/review-requests.e2e-spec.ts` in `apps/api` against the throwaway backends. Expected: FAIL (404 on the route).
- [ ] **Step 3:** Implement the service, DTO, controller, events, errors and `explicitRole`. Mirror `IssuesService.setIssueAssignees` for transaction, `issueEvent` insert and `publishEvent`. Adding when a pending row exists is a no-op (`onConflictDoNothing` on the partial index). Swagger decorators as on neighbouring routes.
- [ ] **Step 4:** Run the e2e test. Expected: PASS.
- [ ] **Step 5:** Commit `feat(api): request and remove pull request reviewers`.

---

### Task 3: Clear requests when a review is submitted

**Files:**
- Modify: `apps/api/src/resources/pull-requests/reviews.service.ts` (`submitReview`, the transaction around line 121)
- Modify: `apps/api/src/resources/pull-requests/review-requests.service.ts`
- Test: `apps/api/test/review-requests.e2e-spec.ts` (new cases)

**Interfaces:**
- Produces: `ReviewRequestsService.clearForReview(tx: Executor, args: { pullRequestId: string; reviewerId: string; reviewId: string }): Promise<void>`. Sets `clearedAt = now()` and `clearedReason = 'reviewed'` on the reviewer's pending user request and on every pending team request whose team the reviewer is a member of. Inserts one `pull_request_review_on_behalf_of` row per cleared team. Publishes **no** `review_request_removed` event.

- [ ] **Step 1: Write failing cases:**
  - Requested user submits `commented`: request cleared, `clearedReason === 'reviewed'`.
  - A pending (unsubmitted) review leaves the request pending.
  - A member of two requested teams approves: both team requests cleared; two on-behalf-of rows.
  - No `pull_request.review_request_removed` outbox row for these clears.
  - Re-request after a review: new pending row (Review Focus 3).
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Call `clearForReview` inside the `submitReview` transaction, before `publishEvent`. Inject `ReviewRequestsService` into `ReviewsService`.
- [ ] **Step 4:** Run the e2e file. Expected: PASS.
- [ ] **Step 5:** Commit `feat(api): a submitted review answers its review requests`.

---

### Task 4: Notifications and webhooks

**Files:**
- Modify: `apps/api/src/services/notifications/notifier.service.ts`
- Modify: `apps/api/src/mail/components/thread.tsx` (reason copy) and the mail template map in `apps/api/src/mail/mail.service.ts` (new `thread-review-requested` template)
- Modify: `apps/api/src/lib/webhooks/webhooks.ts` (`webhookEvents`)
- Modify: `apps/api/src/services/webhooks/webhook-fanout.service.ts`
- Modify: `apps/api/src/lib/webhooks/formats/message.ts`
- Test: `apps/api/src/services/notifications/notifications.integration.spec.ts`, `apps/api/src/lib/webhooks/formats/formats.spec.ts`

**Interfaces:**
- Consumes: Task 2 events.
- Produces: `Activity` gains `reviewRequestedIds: string[]`, mapped to reason `review_requested` in `recipientsOf`, ranked above `mentioned` and below `assigned`. A team request expands to team members. The author and actor are excluded as today.

- [ ] **Step 1: Write failing tests:**
  - Notifier: `pull_request.review_requested` for a user creates a `review_requested` notification and a subscription, and sends an email. For a team: every member except the actor and the author (Review Focus 2).
  - `review_request_removed` notifies nobody.
  - formats.spec: both events render a message (e.g. "alice requested a review from bob on #1"), following the `pull_request.ready_for_review` case.
- [ ] **Step 2:** Run `bunx vitest run src/services/notifications src/lib/webhooks`. Expected: FAIL.
- [ ] **Step 3:** Add `'pull_request.review_requested'` to `notifyingEvents` and its `activityOf` case. Add both events to `webhookEvents`, the fanout payload (include `requested_reviewer` or `requested_team`, as GitHub) and `message.ts`. Email subject: `@<actor> requested your review on: <title> (#<n>)`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(api): notify and deliver review requests`.

---

### Task 5: GitHub REST

**Files:**
- Create: `apps/api/src/github/rest/pulls/requested-reviewers.controller.ts`
- Modify: `apps/api/src/github/rest/pulls/pulls.module.ts`
- Modify: `apps/api/src/lib/github/rest.ts` (`toPullRest`: `requested_reviewers`, `requested_teams`)
- Modify: whatever loads pulls for `toPullRest` (`apps/api/src/github/rest/pulls/pulls.service.ts`) to pass the pending requests
- Test: `apps/api/test/github-pulls.e2e-spec.ts`

**Interfaces:**
- Consumes: `ReviewRequestsService.list/request/remove`.
- Produces: `GET/POST/DELETE /repos/{owner}/{repo}/pulls/{n}/requested_reviewers` with body `{ reviewers?: string[]; team_reviewers?: string[] }`. GET answers `{ users: SimpleUser[], teams: Team[] }`. POST answers the pull request (201). DELETE answers the pull request (200). Use the existing user/team REST shapes in `lib/github/rest.ts`.

- [ ] **Step 1: Write failing cases** in `github-pulls.e2e-spec.ts`: POST then GET returns the user; `GET /pulls/{n}` has `requested_reviewers[0].login`; DELETE empties it; an unknown login answers 422 with GitHub's error body.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Route errors through the existing `github-rest.filter.ts`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(github): REST requested reviewers`.

---

### Task 6: GitHub GraphQL and search

**Files:**
- Modify: `apps/api/src/github/graphql/resolvers/pull-request/pull-request.resolver.ts` (`reviewRequests`, line ~311)
- Modify: `apps/api/src/github/graphql/types/pull-request.type.ts` (`ReviewRequestNode.asCodeOwner`, `PullRequestReview.onBehalfOf`)
- Modify: `apps/api/src/github/graphql/resolvers/pull-request-mutations/pull-request-mutations.{resolver,service}.ts` (`requestReviews`)
- Modify: `apps/api/src/github/graphql/resolvers/search/search.service.ts` (drop the `review-requested` early return, line 43)
- Modify: `apps/api/src/lib/github/issue-search.ts` (parse `user-review-requested`, `team-review-requested`)
- Modify: `apps/api/src/resources/issues/issues.service.ts` (`getIssues` filter `reviewRequested`)
- Test: `apps/api/test/github-graphql.e2e-spec.ts`, `apps/api/src/lib/github/issue-search.spec.ts`, `apps/api/test/gh-cli.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `requestReviews(input: { pullRequestId: ID!, userIds: [ID!], teamIds: [ID!], union: Boolean })`. `union: true` adds; otherwise the pending set becomes exactly the given ids. Returns `{ pullRequest }`.
  - `getIssues` query option `reviewRequested?: { userId: string; direct: boolean } | { teamId: string }`. A user matches a pending request to them, or (`direct: false`) to any team they belong to.

- [ ] **Step 1:** Run `gh pr edit --add-reviewer`, `--remove-reviewer` and `gh pr create --reviewer` against github.com with `GH_DEBUG=api`, or read the gh source, to find the exact mutations and fields `gh` sends. Record them in the test.
- [ ] **Step 2: Write failing tests:**
  - issue-search.spec: `review-requested:@me`, `user-review-requested:bob`, `team-review-requested:acme/infra` parse.
  - github-graphql e2e: `reviewRequests` lists a requested user with `asCodeOwner: false`; `requestReviews` with `union: true` adds, without it replaces; `onBehalfOf` lists the team after a member reviews.
  - gh-cli e2e: `gh pr create --reviewer <user>`, `gh pr edit --add-reviewer/--remove-reviewer`, and `gh pr status` listing the PR under "Requesting a code review from you".
- [ ] **Step 3:** Run. Expected: FAIL.
- [ ] **Step 4:** Implement. Update the ponytail comment in `search.service.ts` so it no longer says review requests are missing.
- [ ] **Step 5:** Run the three suites. Expected: PASS. gh label/paginate cases only run in CI; note any skipped.
- [ ] **Step 6:** Commit `feat(github): GraphQL review requests, requestReviews and review-requested search`.

---

### Task 7: CODEOWNERS parser and matcher

**Files:**
- Create: `apps/api/src/lib/codeowners/codeowners.ts`
- Test: `apps/api/src/lib/codeowners/codeowners.spec.ts`

**Interfaces:**
- Produces:
  - `export const CODEOWNERS_PATHS = ['.ghost/CODEOWNERS', '.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'] as const;`
  - `export const MAX_CODEOWNERS_BYTES = 3 * 1024 * 1024;`
  - `type CodeownersOwner = { kind: 'user'; username: string } | { kind: 'team'; organization: string; slug: string } | { kind: 'email'; email: string }`
  - `type CodeownersRule = { line: number; pattern: string; owners: CodeownersOwner[]; ownerColumns: number[] }`
  - `type CodeownersError = { line: number; column: number; kind: string; source: string; suggestion: string | null; message: string; path: string }`, GitHub's `codeowners/errors` item.
  - `parseCodeowners(text: string, path: string): { rules: CodeownersRule[]; errors: CodeownersError[] }`. Syntax errors only. Error kinds `Invalid pattern` and `Invalid owner`.
  - `matchingRule(rules: CodeownersRule[], filePath: string): CodeownersRule | null`. The **last** match wins.

- [ ] **Step 1: Write failing tests**, using GitHub's documented example file (docs.github.com "About code owners", the example CODEOWNERS):
  - `*` matches everything. A later `*.js @js-owner` overrides it for `src/a.js`.
  - `/build/logs/` matches `build/logs/x/y.txt`, not `src/build/logs/a`.
  - `docs/*` matches `docs/a.md`, not `docs/sub/b.md`.
  - `apps/` matches `apps/x` and `src/apps/x`.
  - `/docs/` with no owners after `docs/* @docs`: `docs/a.md` has a rule with `owners: []`.
  - `**/logs` matches `logs`, `a/logs`, `a/b/logs/c`.
  - `\#file` matches a file named `#file`; `# comment` and blank lines produce nothing.
  - `!foo @a` gives an `Invalid pattern` error; `foo[ab] @a` gives `Invalid pattern`; `foo alice` gives `Invalid owner` at column 5.
  - `@org/team` and `a@b.com` parse as team and email owners.
- [ ] **Step 2:** Run `bunx vitest run src/lib/codeowners` in `apps/api`. Expected: FAIL.
- [ ] **Step 3:** Add the `ignore` package (gitignore matching, pin `7.0.5`) to `apps/api` with `bun add ignore@7.0.5 --cwd apps/api`. Implement:
  - Build one `ignore().add(pattern)` matcher per rule. `matchingRule` walks the rules from last to first and returns the first whose matcher `ignores(filePath)`.
  - Reject `!` and `[ ]` patterns as `Invalid pattern` before they reach `ignore`, because `ignore` accepts both.
  - Do not hand-write glob matching. If a GitHub example fails with `ignore`, adapt the pattern before passing it in, e.g. CODEOWNERS `docs/*` must not match `docs/sub/b.md`. Do not replace the library.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(api): CODEOWNERS parser and matcher`.

---

### Task 8: CodeownersService, error check and endpoints

**Files:**
- Create: `apps/api/src/services/codeowners/codeowners.service.ts` (+ module, registered where other services are)
- Create: `apps/api/src/resources/repositories/codeowners.controller.ts` (Ghost routes)
- Create: `apps/api/src/github/rest/repos/codeowners.controller.ts` (GitHub route)
- Test: `apps/api/src/services/codeowners/codeowners.service.spec.ts` or `apps/api/test/codeowners.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 7; `statBlob` / `readBlob` from `lib/git/blob/read-blob.ts`; the materializer (as `PullRequestsService.open` uses it) to get a git dir; `RepositoryAccessService.explicitRole`; `teamSlug`; `userEmail` (verified rows) and `user.emailVerified`.
- Produces:
  - `type ResolvedOwner = { kind: 'user'; userId: string; username: string } | { kind: 'team'; teamId: string; slug: string; organization: string }`
  - `type LoadedCodeowners = { path: string; rules: CodeownersRule[]; errors: CodeownersError[]; resolve(owner: CodeownersOwner): ResolvedOwner | null }`
  - `CodeownersService.load(repository: { id: string; organizationId: string | null }, gitDir: string, ref: string): Promise<LoadedCodeowners | null>`. Null when no file, or the file is over `MAX_CODEOWNERS_BYTES`. Errors include syntax errors plus resolution errors: `Unknown owner`, `Unknown team`, `Owner without write access`, `Team without write access`. Message example: `Unknown owner on line 4: make sure @alcie exists and has write access to the repository`.
  - `CodeownersService.ownersOf(loaded: LoadedCodeowners, filePath: string): ResolvedOwner[]`, only owners that resolved with write access.
  - `CodeownersService.activePath(gitDir: string, ref: string): Promise<string | null>`
  - Ghost: `GET /repositories/:username/:repo/codeowners?ref=` → `{ path: string | null; errors: CodeownersError[] }`; `GET /repositories/:username/:repo/codeowners/owners?ref=&path=a&path=b` → `{ owners: Record<string, string[]> }` (logins like `@alice`, `@acme/infra`).
  - GitHub: `GET /repos/{owner}/{repo}/codeowners/errors?ref=` → `{ errors: CodeownersError[] }`. Default ref is the default branch. 404 when there is no file.

- [ ] **Step 1: Write failing tests** with a repo that has `.github/CODEOWNERS` and `.ghost/CODEOWNERS` on `main`:
  - `.ghost/CODEOWNERS` is the active path. Owners come from it only.
  - `@alcie` gives an `Unknown owner` error at the right line. A collaborator with read only gives `Owner without write access` and is absent from `ownersOf` (Review Focus 5).
  - A team with write through `repository_team` resolves. An email resolves only when verified.
  - With no file, GitHub `codeowners/errors` answers 404.
  - A file over 3 MB counts as none.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Read access on the repository guards all three routes.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(api): load CODEOWNERS, report its errors`.

---

### Task 9: Automatic code-owner requests

**Files:**
- Create: `apps/api/src/services/codeowners/codeowner-requests.service.ts`
- Modify: `apps/api/src/services/events/outbox.service.ts` (call it beside `notifier.handle` / `webhooks.handle`)
- Test: `apps/api/test/codeowner-requests.e2e-spec.ts`

**Interfaces:**
- Consumes: `CodeownersService.load/ownersOf`; `PullRequestsService.open` (base git dir, `mergeBase`, `headSha`) and `listDiffFiles` as `getFiles` uses them; `ReviewRequestsService.addRequests` with `asCodeOwner: true`.
- Produces: `CodeownerRequestsService.handle(event: StoredEvent): Promise<void>`. Acts on:
  - `issue.opened` when the issue is a non-draft pull request;
  - `pull_request.ready_for_review`;
  - `pull_request.synchronized` when the request is open and not a draft.
  It requests owners of every changed file, read from the **base** repository's base ref, except owners with **any** row (pending or cleared) for this pull request. The author is skipped by `addRequests`. Catches and logs its own errors, so the outbox never retries an event because of CODEOWNERS.

- [ ] **Step 1: Write failing tests:**
  - CODEOWNERS on `main`: `*.txt @reviewer`. Opening a PR that changes `a.txt` creates a pending request with `asCodeOwner: true`, and a timeline event from the PR author.
  - A draft PR requests nobody. Marking it ready requests the owner.
  - The owner reviews. A push that changes another `.txt` file does not re-request them.
  - Removing a code-owner request by hand, then pushing: not re-requested.
  - A push touching `b.md` with `*.md @other`: `other` is added.
  - Same outbox event handled twice: one row (Review Focus 1).
  - A PR whose head adds `.ghost/CODEOWNERS` naming someone requests nobody from it (Review Focus 4).
  - A malformed CODEOWNERS file does not fail PR creation.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement and wire it into the outbox loop.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(api): request reviews from code owners`.

---

### Task 10: Web, PR sidebar Reviewers and timeline

**Files:**
- Modify: `apps/web/src/app/[username]/[repo]/pull/[number]/page.tsx`. The PR page has no sidebar yet. Add one with the issue page's grid (`lg:grid-cols-[minmax(0,1fr)_260px]`, `apps/web/src/app/[username]/[repo]/issues/[number]/page.tsx:52`).
- Create: `apps/web/src/app/[username]/[repo]/pull/[number]/reviewer-editor.tsx`, modelled on `issues/[number]/assignee-editor.tsx`
- Create: `apps/web/src/components/pull-requests/reviewer-picker.tsx`, modelled on `components/issues/assignee-picker.tsx`, with users and teams
- Modify: `apps/web/src/components/issues/actions.ts`, or a sibling `components/pull-requests/actions.ts`: `requestReviewers` / `removeReviewers` server actions
- Modify: `apps/web/src/components/issues/timeline.tsx` (two event types)
- Run: `bun openapi` at the root

**Interfaces:**
- Consumes: Ghost routes from Task 2; the PR's reviews (already loaded for the merge panel's verdicts).

- [ ] **Step 1:** Run `bun openapi`. Expected: `apps/web/src/lib/api/v1.d.ts` has `requested-reviewers`.
- [ ] **Step 2:** Build the Reviewers section:
  - One row per requested or reviewing person or team, with a state icon: pending, approved, changes requested, commented.
  - A shield and "Code owner" tooltip when `asCodeOwner`.
  - ↻ re-request beside anyone who has reviewed.
  - The picker shows only when `atLeast(role, 'triage')`.
- [ ] **Step 3:** Timeline: "@a requested a review from @b", "@a removed the request for review from @b", and the team variants.
- [ ] **Step 4:** Run `bun run --filter @ghost/web typecheck` (or `tsc --noEmit`) and `bun test` in apps/web. Expected: PASS. Then use the `run` skill to open a PR locally, request a reviewer and check the sidebar and timeline.
- [ ] **Step 5:** Commit `feat(web): reviewers on pull requests`.

---

### Task 11: Web, pulls filter and dashboard

**Files:**
- Modify: `apps/web/src/app/[username]/[repo]/pulls/page.tsx` (a "Review requested" filter)
- Modify: `apps/web/src/app/dashboard/page.tsx` (a "Review requests" list)
- Modify: `apps/api/src/resources/pull-requests/pull-requests.controller.ts` + service: `reviewRequested?: string` query on `GET pulls` (username or `@me`)
- Create: a dashboard API route if no existing one fits, `GET /user/review-requests` → open PRs requesting the viewer directly or through a team, across repositories the viewer can read
- Test: extend `test/review-requests.e2e-spec.ts`

- [ ] **Step 1: Write failing e2e cases:** `GET pulls?reviewRequested=@me` lists only requested PRs, including through a team. `GET /user/review-requests` lists them across two repos and hides a repo the viewer lost access to.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the API, then `bun openapi`, then the two UI pieces.
- [ ] **Step 4:** Run the tests and the web typecheck. Expected: PASS.
- [ ] **Step 5:** Commit `feat: review requests on the pulls list and dashboard`.

---

### Task 12: Web, ownership and CODEOWNERS errors

**Files:**
- Modify: `apps/web/src/app/[username]/[repo]/blob/[ref]/[[...path]]/page.tsx` (shield in the file header; errors banner and line markers)
- Modify: `apps/web/src/app/[username]/[repo]/pull/[number]/files/page.tsx` and `review-diff.tsx` (owner shield per file, from the base ref)
- Create: `apps/web/src/components/codeowners/owners-badge.tsx`

**Interfaces:**
- Consumes: Task 8 Ghost routes.

- [ ] **Step 1:** Blob view:
  - Fetch `codeowners/owners?ref=&path=`. Show a shield with "Owned by @a and @org/t" when there are owners.
  - When the path is one of `CODEOWNERS_PATHS` (copy the list into web) and equals the active path, fetch `codeowners?ref=`. Show the banner "This CODEOWNERS file contains N errors". Give each listed line a gutter marker and underline, with the message on hover.
  - When it is a candidate but not active, show "Ignored: <active path> takes precedence".
- [ ] **Step 2:** PR files tab:
  - One `codeowners/owners` call with all changed paths at the PR's `baseRef`.
  - Shield per file header, highlighted when the viewer is among the owners (direct, or through a team).
- [ ] **Step 3:** Typecheck and `bun test` in apps/web. Then use the `run` skill: push a repo with a broken `.ghost/CODEOWNERS` and a `.github/CODEOWNERS`, and check the banner, markers, ignored notice and shields.
- [ ] **Step 4:** Commit `feat(web): code owners on files and CODEOWNERS errors`.

---

### Task 13: Docs

**Files:**
- Modify: `docs/roadmap.md`. Mark review requests and CODEOWNERS done under Pull requests. Note that the "require code owner review" rule waits for rulesets (#17).
- Create: an ADR `docs/00NN-review-requests-keep-their-history.md` (next free number). It records why cleared requests are kept (code-owner re-request rule) and why ownership is read from the base ref.
- Modify: the user docs in `apps/docs`, if pull request docs live there: requesting reviewers, CODEOWNERS file locations including `.ghost/CODEOWNERS`.

- [ ] **Step 1:** Write the three changes.
- [ ] **Step 2:** Commit `docs: review requests and CODEOWNERS`.
- [ ] **Step 3:** File the deferred team auto-assignment issue on Ghost and GitHub, with the spec's "Deferred" section as its body.
