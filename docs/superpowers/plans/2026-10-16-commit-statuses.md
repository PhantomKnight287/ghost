# Commit Statuses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** External callers post commit statuses to Ghost through GitHub's Statuses API; Ghost shows them on pull requests, commit lists and the commit page, in `gh pr checks`, and as a webhook event.

**Architecture:** One append-only `commit_status` table and one `CommitStatusesService` under `apps/api/src/resources/commit-statuses/`. The native controller, the GitHub REST controller, the GraphQL rollup, the pull request and repository services all call that service. Pull requests read statuses from both the base and the head repository; everything else reads one repository.

**Tech Stack:** NestJS, drizzle (Postgres), vitest, Next.js app router, openapi-typescript, GraphQL code-first (`@nestjs/graphql`).

**Spec:** `docs/superpowers/specs/2026-10-16-commit-status-design.md`

## Global Constraints

- States are exactly `pending`, `success`, `failure`, `error`. GraphQL uses the uppercase `StatusState` enum.
- `context` defaults to `default`. `description` at most 140 characters. At most 1000 statuses per `(repository, sha, context)`.
- Rows are never updated or deleted, except by repository cascade.
- Combined state: newest row per context; `failure` if any is `failure` or `error`, else `pending` if any is `pending`, else `success`. No statuses: REST `pending` with an empty list; GraphQL `statusCheckRollup` null; web shows nothing.
- POST: unknown sha, bad state, too-long description, or over the cap → 422. Write access plus `requireWriteScope`.
- Reads: read access; anonymous on public repositories.
- Fork pull requests merge base and head repository statuses; same context in both → the base repository's newest wins, so a fork cannot override the base's checks; fork included only when the viewer can read it.
- Only event: `commit_status.created`. No live updates in the web app.
- Follow `docs/code-standards.md`: no `to<Format>` reshapers outside `lib/github/`, one-line comments, `lib/` for pure code, `services/` for injectables.
- Never hand-edit drizzle SQL: run `bun db:generate` at the repo root.
- Integration specs need `TEST_DATABASE_URL` pointing at a throwaway Postgres (docker). Never the dev database at 192.168.1.4.

## Review Focus

- A status posted for a fork PR's head sha to the fork, viewed on the base PR by someone who cannot read the fork (private fork): the fork's status must not appear. Test in Task 5.
- Same context posted twice, `pending` then `success`: combined shows only `success`, history shows both, newest first. Test in Task 2.
- Abbreviated sha on POST (`76bb6d3`): GitHub requires a full sha for POST; answer 422, never store a short sha. Test in Task 2.
- `commits/:ref/status` with a branch name containing a slash (`feat/x`): resolves to the branch tip. Test in Task 4.
- A merged pull request still shows its head's checks in the merge panel. Covered by Task 5's `checks` on a merged PR test and Task 7's render.

---

### Task 1: Combined-state rule

**Files:**
- Create: `apps/api/src/lib/commit-statuses/commit-statuses.ts`
- Create: `apps/api/src/lib/commit-statuses/commit-statuses.errors.ts`
- Test: `apps/api/src/lib/commit-statuses/commit-statuses.spec.ts`

**Interfaces:**
- Produces:
  - `COMMIT_STATUS_STATES = ['pending', 'success', 'failure', 'error'] as const`, `type CommitStatusState`
  - `MAX_STATUS_DESCRIPTION = 140`, `MAX_STATUSES_PER_CONTEXT = 1000`, `DEFAULT_STATUS_CONTEXT = 'default'`
  - `combinedState(states: CommitStatusState[]): CommitStatusState`
  - `TooManyStatusesError(sha: string, context: string)` and `InvalidStatusShaError(sha: string)`, both `DomainError` subclasses like `lib/releases/releases.errors.ts`, mapped to 422

- [ ] **Step 1: Write the failing test** `combinedState`:
  - `[]` → `'pending'`
  - `['success', 'success']` → `'success'`
  - `['success', 'pending']` → `'pending'`
  - `['pending', 'error']` → `'failure'`
  - `['failure', 'success']` → `'failure'`
- [ ] **Step 2:** Run `bun run test src/lib/commit-statuses` in `apps/api`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement the constants, `combinedState`, and the two errors.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `add combined commit status rule`.

### Task 2: Table and service

**Files:**
- Create: `packages/db/src/schema/commit-statuses.ts`, export from `packages/db/src/schema/index.ts`
- Generated: migration under `packages/db` via `bun db:generate`
- Create: `apps/api/src/resources/commit-statuses/commit-statuses.service.ts`
- Create: `apps/api/src/resources/commit-statuses/commit-statuses.module.ts`
- Create: `apps/api/src/resources/commit-statuses/dto/commit-status.dto.ts`
- Modify: `apps/api/src/lib/events/events.ts` (payload), `apps/api/src/lib/webhooks/webhooks.ts` (`webhookEvents`)
- Test: `apps/api/src/resources/commit-statuses/commit-statuses.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - Table `commitStatus`: `id` (`cst_${createId()}`), `numericId` (bigint identity, unique, comment as on `release.numericId`), `repositoryId` (cascade), `sha`, `state` (pgEnum `commit_status_state` from `COMMIT_STATUS_STATES`), `context` (not null, default `default`), `description` (nullable), `targetUrl` (nullable), `creatorId` (references `user`, set null), `createdAt` (timestamptz, default now). Index `commit_status_lookup_idx` on `(repositoryId, sha, context, createdAt)`.
  - DTOs:
    - `CreateCommitStatusRequestDTO { state; targetUrl?; description?; context? }`, class-validator: `@IsIn(COMMIT_STATUS_STATES)`, `@MaxLength(140)`, `@IsUrl` on targetUrl
    - `CommitStatusDTO { id; state; context; description: string | null; targetUrl: string | null; createdAt: string; creator: { username: string; image: string | null } | null }`
    - `CombinedCommitStatusDTO { sha; state; totalCount; statuses: CommitStatusDTO[] }`
  - Event `'commit_status.created': { statusId: string }`, added to `webhookEvents`.
  - `CommitStatusesService`:
    - `create(target: { username; repo; requesterId: string; sha: string; body: CreateCommitStatusRequestDTO }): Promise<CommitStatusDTO>`
    - `combined(target: { username; repo; requesterId?; ref: string }): Promise<CombinedCommitStatusDTO>`
    - `pageStatuses(target: { username; repo; requesterId?; ref: string; offset: number; limit: number }): Promise<{ sha: string; statuses: CommitStatusDTO[]; total: number }>`, newest first
    - `combinedFor(repositoryIds: string[], shas: string[]): Promise<Map<string, CombinedCommitStatusDTO>>`. No authorization; callers pass repositories they already authorized. A sha with no statuses is absent from the map.
  - `CommitStatusesModule` exports `CommitStatusesService`.

Approach:
- `create` authorizes with `operation: 'write'` and rejects anything not matching `/^[0-9a-f]{40}$/` with `InvalidStatusShaError`. It confirms the commit with `resolveCommit(await materializer.open(repository), sha)`; when that returns null, it throws `InvalidStatusShaError`. It counts existing rows for `(repository, sha, context)` and throws `TooManyStatusesError` at 1000. It inserts and calls `publishEvent(tx, { type: 'commit_status.created', statusId })` in one transaction.
- `ref` resolves as `ReleasesService` does: `resolveTargetCommit` with `listBranches` and `listTags`. No match → the existing `CommitNotFoundError`.
- `combinedFor` uses one `selectDistinctOn([sha, context])` over `repositoryId in (...)` and `sha in (...)`, ordered by the repository's position in `repositoryIds`, then `createdAt desc`. That merges forks with the first repository (the base) winning a shared context. It then groups by sha and applies `combinedState`.

- [ ] **Step 1: Write the failing integration tests** (skipped without `TEST_DATABASE_URL`, set up like `releases.integration.spec.ts`):
  - `create` stores a status and publishes one `commit_status.created` outbox row carrying its id
  - `pending` then `success` on `ci`: `combined` → `{ state: 'success', totalCount: 1 }`; `pageStatuses` → 2 rows, `success` first
  - `ci` success plus `deploy` error → combined `failure`, totalCount 2
  - `combined` on a commit with no statuses → `{ state: 'pending', totalCount: 0, statuses: [] }`
  - `combined` with `ref: 'main'` equals `combined` with the tip's sha
  - POST with an abbreviated sha → `InvalidStatusShaError`; with an unknown 40-hex sha → `InvalidStatusShaError`
  - a reader without write access → the access service's forbidden error
  - the 1001st status on one context → `TooManyStatusesError`. Insert 1000 rows directly to seed it.
  - `combinedFor([base, fork], [sha])`, with `ci` failure in base (older) and `ci` success in fork (newer) → state `failure`, one `ci` status: the base's
- [ ] **Step 2:** Run `TEST_DATABASE_URL=… bun run test src/resources/commit-statuses`. Expected: FAIL.
- [ ] **Step 3:** Add the schema, run `bun db:generate` at the root, then implement the DTOs, service, module and event.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `store commit statuses`.

### Task 3: Native routes and webhook body

**Files:**
- Create: `apps/api/src/resources/commit-statuses/commit-statuses.controller.ts`, register it in the module and the module in `app.module.ts`
- Modify: `apps/api/src/services/webhooks/webhook-fanout.service.ts` (a `commit_status.created` case)
- Modify: `apps/api/src/lib/webhooks/formats/message.ts` (a `commit_status.created` case)
- Modify: `docs/webhooks.md` (list the event and its `status` body)
- Test: extend `apps/api/src/resources/webhooks/webhooks.integration.spec.ts` and `apps/api/src/lib/webhooks/formats/formats.spec.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - `POST /api/repositories/:username/:slug/statuses/:sha` with body `CreateCommitStatusRequestDTO`, returning 201 and `CommitStatusDTO`
  - `GET /api/repositories/:username/:slug/commits/:ref/status` returning `CombinedCommitStatusDTO`
  - Webhook body field `status: { id, sha, state, context, description, targetUrl, createdAt }`
  - Message line: `` `set ${context} to ${state} on ${sha.slice(0, 7)}` ``. Green for success, red for failure and error, grey for pending. Links to `targetUrl` or the commit page, with `description` as detail.
- Native history listing is not exposed. The web app needs only the combined status, and GitHub's REST serves the history. (My call, within "native paths are builder's call".)

- [ ] **Step 1: Write the failing tests:**
  - The fanout builds `status` for a `commit_status.created` event and skips the event when the row is gone.
  - The message formatter renders `set ci to failure on 76bb6d3` with the red colour and the target URL.
- [ ] **Step 2:** Run both specs. Expected: FAIL.
- [ ] **Step 3:** Implement the controller (with `@ApiOperation` summaries), the fanout case, the message case and the docs entry.
- [ ] **Step 4:** Rerun. Expected: PASS. Then run `bun run openapi` in `apps/api`. Expected: `openapi.json` gains both routes.
- [ ] **Step 5:** Commit `serve commit statuses and their webhook event`.

### Task 4: GitHub REST

**Files:**
- Create: `apps/api/src/github/rest/statuses/statuses.controller.ts`, `statuses.service.ts`, `statuses.module.ts`, `dto/status.dto.ts`; register the module where the other `Github*Module`s are
- Modify: `apps/api/src/lib/github/rest.ts` (add `toStatusRest`, `toCombinedStatusRest`)
- Modify: `apps/api/src/lib/github/node-id.ts` (`StatusContext: 'SC'`, `StatusCheckRollup: 'SCR'`)
- Modify: `apps/api/src/lib/github/node-lookup.ts` (`commitStatusNumericIdsOf(db, ids)`, like `releaseNumericIdsOf`)
- Test: `apps/api/src/github/rest/statuses/statuses.controller.spec.ts`, following `repos.controller.spec.ts`

**Interfaces:**
- Consumes: Task 2's service and DTOs.
- Produces, under `@Controller('v3')` with `GithubRestFilter`:
  - `POST repos/:owner/:repo/statuses/:sha`, body `{ state, target_url?, description?, context? }`. Uses `github.writable(...)` with `'POST /repos/:owner/:repo/statuses/:sha'`, which applies `requireWriteScope`. Answers 201.
  - `GET repos/:owner/:repo/commits/{*ref}/statuses`, offset-paged with `pageOf` and `RestPage`, newest first
  - `GET repos/:owner/:repo/commits/{*ref}/status`
  - `toStatusRest(status, numericId, sha, context: RestContext)` → `{ url, avatar_url, id, node_id, state, description, target_url, context, created_at, updated_at, creator }`. `url` is `${apiUrl}/statuses/${sha}`, `updated_at` equals `created_at`, and `node_id` is `encodeNodeId('StatusContext', id)`.
  - `toCombinedStatusRest(combined, statuses, repository, context)` → `{ state, statuses, sha, total_count, repository, commit_url, url }`
- Error mapping: `InvalidStatusShaError`, `TooManyStatusesError` and DTO validation → 422 in GitHub's validation shape. `CommitNotFoundError` on GET → 404 `No commit found for SHA: <ref>`.

`creator` and `avatar_url` come from the same `context.users` lookup `GithubReleasesService` uses for release authors; a deleted creator reads as `null` and `avatar_url: ''`.

Approach: the ref route uses `{*ref}` like `zipball{/*ref}` in `repos.controller.ts`, so `feat/x` works. Because `{*ref}` is greedy, the `/statuses` or `/status` suffix has to be split off inside the handler; the builder may pick a different route shape if Nest offers one.

- [ ] **Step 1: Write the failing controller tests:**
  - POST returns 201 with `state: 'success'`, `context: 'default'` when omitted, and `url` ending `/statuses/<sha>`
  - POST with `state: 'done'` → 422; with a 141-character description → 422
  - GET `commits/<sha>/statuses` after two posts → 2 items, newest first, plus a `Link` header when paged
  - GET `commits/main/status` → `state`, `sha` equal to the tip, `total_count`
  - GET `commits/feat/x/status` resolves the `feat/x` branch
  - GET with an unknown ref → 404
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun. Expected: PASS. Run `bun run openapi`, then `bun run test src/github/gh-capture.spec.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `serve GitHub's commit status REST`.

### Task 5: Statuses on pull requests and commit lists (API)

**Files:**
- Modify: `apps/api/src/resources/pull-requests/pull-requests.service.ts` (`getPullRequest`, `getCommits`), its DTOs and its module (import `CommitStatusesModule`)
- Modify: `apps/api/src/resources/repositories/repositories.service.ts` (the commit list near line 1777 and `getRepositoryCommit`), its DTOs and its module
- Test: extend `apps/api/src/resources/pull-requests/*.integration.spec.ts` and the repositories integration spec

**Interfaces:**
- Consumes: `CommitStatusesService.combinedFor`.
- Produces:
  - Pull request detail: `checks: CombinedCommitStatusDTO | null`, the head sha's combined status. Present on open, merged and closed requests.
  - Each commit in the PR Commits list, the repository commit list and the single commit: `status: CombinedCommitStatusDTO | null`, next to `verification`
  - Private `statusRepositoryIds(pullRequest, base, requesterId?): Promise<string[]>` in `PullRequestsService`. It returns `[base.id]`, plus `headRepositoryId` when that differs from `base.id` and `access.authorizeById({ repositoryId, requesterId })` succeeds.

- [ ] **Step 1: Write the failing tests:**
  - a same-repo PR with `ci` success on the head → `checks.state === 'success'`
  - a PR with no statuses → `checks === null`
  - a merged PR keeps `checks` for its head sha
  - a fork PR, `ci` posted to the fork, viewed by someone who can read the fork → included; with the fork private and the viewer not a collaborator → `checks === null`
  - `getCommits` and the repository commit list attach `status` per commit, and `null` for commits without statuses
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement with one `combinedFor` call per response.
- [ ] **Step 4:** Rerun. Expected: PASS. Run `bun run openapi` in `apps/api` and `bun run generate` in `apps/web`.
- [ ] **Step 5:** Commit `attach commit statuses to pull requests and commit lists`, including `openapi.json` and `v1.d.ts`.

### Task 6: GraphQL rollup and `gh pr checks`

**Files:**
- Modify: `apps/api/src/github/graphql/types/placeholders.type.ts`. The `StatusCheckRollupNode` comment says "Always null until #61"; update it. Add a non-field property `contexts: StatusContextNode[]`.
- Modify: `apps/api/src/github/graphql/types/pull-request.type.ts` (`CommitNode` gains a non-field `status: CombinedCommitStatusDTO | null`)
- Modify: `apps/api/src/lib/github/nodes.ts` (`toCommitNode` copies `commit.status ?? null`)
- Modify: `apps/api/src/github/graphql/resolvers/pull-request/pull-request.resolver.ts`:
  - `CommitResolver.statusCheckRollup` builds a `StatusCheckRollupNode` from `commit.status`. Its id is `encodeNodeId('StatusCheckRollup', `${repositoryGhostId}:${oid}`)`; it returns null when `status` is null.
  - `StatusCheckRollupResolver.contexts` slices `rollup.contexts` with `sliceConnection`.
- Modify: `apps/api/test/gh-cli.e2e-spec.ts` (new test), and commit the regenerated capture fixture
- Modify: `apps/docs/content/docs/github-cli/index.mdx`: delete the checks bullet at line 166
- Modify: `apps/api/github.schema.gql` (regenerated)

**Interfaces:**
- Consumes: Task 5's `status` on `getCommits` commits, Task 4's node-id prefixes.
- Produces: `StatusContextNode` per status, with `state` uppercased (`StatusState[state.toUpperCase()]`), `createdAt` as a `Date`, and `id` = `encodeNodeId('StatusContext', status.id)`.

- [ ] **Step 1: Write the failing e2e test** `it('lists pull request checks')` in the pull request block:
  1. Read `sha` from `gh pr view <number> --json headRefOid`.
  2. Run `gh api -X POST repos/<repo>/statuses/<sha> -f state=success -f context=ci/test -f description=ok -f target_url=https://ci.example/1`.
  3. Expect `gh pr checks <number> -R <repo> --json name,state,bucket,link` to equal `[{ name: 'ci/test', state: 'SUCCESS', bucket: 'pass', link: 'https://ci.example/1' }]`.
- [ ] **Step 2:** Run `bun run test:e2e -t 'lists pull request checks'` against a throwaway Postgres and rustfs. Expected: FAIL with no checks reported.
- [ ] **Step 3:** Implement, then regenerate the schema.
- [ ] **Step 4:** Rerun the e2e test, `src/github/schema-conformance.spec.ts` and `src/github/gh-capture.spec.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `fill statusCheckRollup so gh pr checks lists statuses`.

### Task 7: Checks box (web)

**Files:**
- Create: `apps/web/src/components/repositories/commit-checks.tsx`, one component family:
  - `CommitStatusIcon({ state })`: lucide `CircleCheck` emerald-500 for success, `CircleX` red-500 for failure and error, `CircleDot` amber-500 for pending
  - `CommitStatusRows({ statuses })`: icon, context, muted description, and a `Details` link to `targetUrl` when set (`target="_blank" rel="noreferrer"`)
  - `CommitChecks({ status })`: the box, option C
- Modify: `apps/web/src/app/[username]/[repo]/pull/[number]/merge-panel.tsx` and `page.tsx` (pass `checks`)
- Modify: the commit page under `apps/web/src/app/[username]/[repo]/commit/[hash]/` (render `CommitChecks` with `commit.status`)

**Interfaces:**
- Consumes: `components["schemas"]["CombinedCommitStatusDTO"]` from `v1.d.ts` (Task 5).
- Produces: `CommitStatusIcon` and `CommitStatusRows`, which Task 8 reuses.

`CommitChecks` behaviour:
- `status` null → renders nothing.
- Failing and pending rows always show.
- Successful ones fold into one line, "N successful check(s)" with a `CommitStatusIcon` success. A toggle expands them into `CommitStatusRows`.
- All successful → only that line.

In `MergePanel`, add a `checks` prop and render `<CommitChecks status={checks} />`:
- open: between the reviewer list and the conflicts line
- merged and closed: above their one-line box, so the early returns become a wrapper that renders the checks first

- [ ] **Step 1:** Run `bun run check-types` in `apps/web`. Expected: FAIL once `page.tsx` passes `checks` and `MergePanel` lacks the prop.
- [ ] **Step 2:** Implement the components and wire the merge panel and the commit page.
- [ ] **Step 3:** Run `bun run check-types` and `bun run lint` in `apps/web`. Expected: PASS.
- [ ] **Step 4:** Use the `run` skill to start the app, post statuses with `curl` to a local repo's PR (one failure, one pending, six successes), and screenshot:
  - an open PR shows two rows plus "6 successful checks"
  - a merged PR still shows its checks
  - the commit page shows the box
- [ ] **Step 5:** Commit `show commit statuses on pull requests and commits`.

### Task 8: Status icon in commit lists (web)

**Files:**
- Modify: `apps/web/src/components/repositories/commit-list.tsx` (the `Commit` type gains `status`; render the icon left of `CommitVerificationBadge`)
- Modify: the callers that build `Commit` from the API (the repository commits page, the PR Commits tab), only if their types need the new field passed through

**Interfaces:**
- Consumes: `CommitStatusIcon`, `CommitStatusRows` (Task 7); `status` per commit (Task 5).

Behaviour:
- `status` null → no icon.
- Otherwise `CommitStatusIcon` for `status.state`, wrapped in the existing `HoverCard` components from `components/ui` (the ones `FromNowHoverCard` uses).
- The hover card shows the title ("All checks have passed", "Some checks were not successful" or "Some checks haven't completed yet"), then `CommitStatusRows` for all statuses.

- [ ] **Step 1:** Run `bun run check-types`. Expected: FAIL once `Commit` requires `status`.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Run `bun run check-types` and `bun run lint`. Expected: PASS.
- [ ] **Step 4:** With the app from Task 7, screenshot the commits page: an icon on commits with statuses, none on others, and the hover card listing contexts.
- [ ] **Step 5:** Commit `show commit status icons in commit lists`.
