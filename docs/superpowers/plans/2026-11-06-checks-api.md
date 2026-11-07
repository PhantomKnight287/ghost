# Checks API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub's check runs and check suites for Ghost Apps: stored, attributed to installations, shown next to commit statuses, honoured by rulesets, with re-runs and buttons routed back to the owning app (Ghost #79).

**Architecture:** Three tables (`check_suite`, `check_run`, `check_annotation`). One `ChecksService` in `resources/checks` owns every write and read. The GitHub compat controller (`github/rest/checks`) and Ghost's own controller are thin mappers over it. A `CommitChecksService` composes `CommitStatusesService.combinedFor` with the newest check runs into one rollup, which the PR DTO, commit list, GraphQL and rulesets read. Automatic suites hook into `PushTransactionService.commitPush`, which every branch writer passes through. Owning-app-only events get a targeted path in `WebhookFanoutService`, modelled on `installationEvent`.

**Tech Stack:** NestJS, Drizzle + Postgres, Vitest (unit, `*.integration.spec.ts` on `TEST_DATABASE_URL`, `test/*.e2e-spec.ts`), `bun test` in packages, Next.js + shadcn in `apps/web`, Octokit in e2e.

**Spec:** `docs/superpowers/specs/2026-11-06-checks-api-design.md`. Read it with this plan. The plan does not repeat its rules; each task names the spec section it implements.

## Global Constraints

- `docs/code-standards.md` applies to every file: no `to<format>` reshaping helpers, no wrapped strings or comments, comments only for why, `services/` holds only `@Injectable()` classes, pure code under `lib/`.
- Migrations: `bun db:generate` at the repo root; never hand-edit drizzle SQL.
- Integration and e2e suites run only against throwaway docker Postgres/Redis/S3 (memory: api-e2e-known-failures), never 192.168.1.4. `bun run openapi` against a throwaway DB too.
- Known failing e2e: fork-quota. Anything else red is ours.
- Only installation tokens create or update check runs and suites. PATs, OAuth keys and `ghu_` user-to-server tokens get 403 (GitHub's message: `Resource not accessible by integration` for apps without the permission; verify the wording for user tokens).
- Limits (spec "Limits"): `name` 1–255; `output.title` ≤ 255; `output.summary` and `output.text` ≤ 65535 each; ≤ 50 annotations per request; ≤ 3 actions, `label` ≤ 20, `description` ≤ 40, `identifier` ≤ 20; ≤ 1000 runs per (repository, sha, name); ≤ 1000 annotations per run.
- Statuses: `queued`, `in_progress`, `completed`. Conclusions: `success`, `failure`, `neutral`, `cancelled`, `skipped`, `timed_out`, `action_required`.
- Event names exactly: `check_run.created`, `check_run.completed`, `check_suite.completed` (subscribable); `check_run.rerequested`, `check_run.requested_action`, `check_suite.requested`, `check_suite.rerequested` (owning app only).
- Commit statuses' existing REST, GraphQL `StatusContext` and `/commits/:ref/status` behave exactly as today.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A re-run that passes clears the failure.** Old run `failure`, new run with the same name `success`. The rollup, the suite conclusion, the required check and the merge panel all show passing. Tested in Tasks 3, 5 and 10.
2. **The same name from two apps.** CI and the sync bot both post `build`. Both rows show. An unpinned required check takes the newest; a pinned one takes only its app's. Tested in Task 10.
3. **A run updated after it completed.** A PATCH on a completed run, like a mirror correcting a conclusion, recomputes the suite. It does not fire `check_run.completed` a second time; `check_suite.completed` fires again only if the suite left `completed` and came back. Tested in Task 5.
4. **A fork head.** Runs posted on the base for a fork's head sha (allowed by the commit-holder rule) show on the pull request and count for rulesets. Runs posted on the fork do not satisfy the base's rules. Tested in Task 10.
5. **A deleted or suspended app.** Its runs still render, attributed to the soft-deleted app. A pinned check naming it fails closed. Re-run on its runs answers 422, and the web hides the button. Tested in Tasks 6 and 10.

---

### Task 1: `checks` permission and check events

**Files:**
- Modify: `packages/permissions/src/apps.ts` (add `checks: ["read", "write"]` after `statuses`)
- Modify: `packages/webhooks/src/index.ts`
- Modify: `apps/web/src/components/apps/permissions.ts` (label: "Checks", description: "Check runs and check suites on commits")
- Test: `packages/webhooks/src/index.test.ts`, `packages/permissions/src/*.test.ts`

**Interfaces:**
- Produces: `WEBHOOK_EVENTS["check_run.created" | "check_run.completed" | "check_suite.completed"]`, all with `permission: "checks"`. These go after `commit_status.created` in the table. Also `OWNING_APP_EVENTS` and `type OwningAppEvent`, exported like `INSTALLATION_EVENTS`, with the four owning-app names. Each carries `permission: "checks"` and a label.

- [ ] **Step 1: Write failing tests** in `packages/webhooks/src/index.test.ts`:
  - `"check events need checks"`: the three subscribable names exist with `permission === "checks"`.
  - `"no owning-app event is subscribable"`: no `OWNING_APP_EVENTS` name is in `webhookEvents`.
  - The existing "every event has a permission from APP_PERMISSIONS" test now needs `checks` in `APP_PERMISSIONS`.
- [ ] **Step 2: Run to confirm they fail.** Run `cd packages/webhooks && bun test`. Expect FAIL on the missing events and the unknown permission `checks`.
- [ ] **Step 3: Implement.** Add the permission and the events, and export `OWNING_APP_EVENTS`. Rebuild the packages the API consumes (`bun run build` in each package, as `@ghost/permissions` does).
- [ ] **Step 4: Run to confirm they pass.** Run `bun test` in both packages. Then run `cd apps/api && bunx tsc --noEmit`. Expect PASS. Fix any `satisfies` errors in `lib/events/events.ts` by adding `EventPayloads` entries now:
  - `'check_run.created' | 'check_run.completed' | 'check_run.rerequested'`: `{ checkRunId: string }`
  - `'check_run.requested_action'`: `{ checkRunId: string; identifier: string }`
  - `'check_suite.completed' | 'check_suite.requested' | 'check_suite.rerequested'`: `{ checkSuiteId: string }`
- [ ] **Step 5: Commit.** `feat(checks): checks permission and check events`

### Task 2: Schema

**Files:**
- Create: `packages/db/src/schema/checks.ts` (export from the schema index next to `commit-statuses`)
- Generated: `packages/db/drizzle/00NN_*.sql` via `bun db:generate`

**Interfaces:**
- Produces:
  - Enums: `checkStatus` (`queued`, `in_progress`, `completed`), `checkConclusion` (the 7 conclusions), `checkAnnotationLevel` (`notice`, `warning`, `failure`).
  - Tables `checkSuite`, `checkRun` and `checkAnnotation`, with the columns in spec "Data model". Ids are prefixed `csu_`, `crn_` and `can_`, and each table has a `numericId` identity column, as `commitStatus` does.
  - `checkSuite`: unique (`repositoryId`, `headSha`, `appId`). `appId` references `app.id` with no cascade; the app is soft-deleted. `installationId` is set null on delete.
  - `checkRun`: index (`repositoryId`, `headSha`, `name`, `createdAt desc`). Also store `completedOnce: boolean` (default false). Task 5 uses it to fire `check_run.completed` only once (Review Focus 3).
  - `checkAnnotation`: index (`runId`, `numericId`).

- [ ] **Step 1: Write the schema file.**
- [ ] **Step 2: Generate.** Run `bun db:generate` at the root. Expect one new migration with three tables and three enums. Read it.
- [ ] **Step 3: Apply to the throwaway DB.** Run `cd apps/api && bun test/migrate.ts`, or the e2e global setup. Expect it to apply cleanly.
- [ ] **Step 4: Commit.** `feat(checks): check suite, run and annotation tables`

### Task 3: Pure check rules

**Files:**
- Create: `apps/api/src/lib/checks/checks.ts`, `apps/api/src/lib/checks/checks.errors.ts`
- Test: `apps/api/src/lib/checks/checks.spec.ts`

**Interfaces:**
- Produces:
  - Constants: `MAX_CHECK_NAME = 255`, `MAX_OUTPUT_TITLE = 255`, `MAX_OUTPUT_TEXT = 65535`, `MAX_ANNOTATIONS_PER_REQUEST = 50`, `MAX_ANNOTATIONS_PER_RUN = 1000`, `MAX_RUNS_PER_NAME = 1000`, `MAX_ACTIONS = 3`.
  - `rollupState(run: { status: CheckStatus; conclusion: CheckConclusion | null }): CommitStatusState`, following spec "Combined state".
  - `suiteState(runs: { name: string; status; conclusion; startedAt: Date | null; createdAt: Date; numericId: number }[]): { status: CheckStatus; conclusion: CheckConclusion | null }`. Only the newest run per name counts (by `createdAt`, ties broken by `numericId`). The precedence is `action_required > cancelled > timed_out > failure > neutral > skipped > success`.
  - `resolveRunWrite(current: RunState | null, body: { status?; conclusion?; completedAt?; startedAt? }, now: Date): RunState`. It applies the implications: a conclusion or `completedAt` means completed; `status` defaults to `queued`; `startedAt` defaults to `now` on create. It throws `CheckRunConclusionRequiredError` for completed without a conclusion, and `ActionRequiredNeedsDetailsUrlError` for `action_required` without a `detailsUrl`.
  - Errors, each a 422 through the existing error mapping (follow `commit-statuses.errors.ts`): `CheckRunConclusionRequiredError`, `ActionRequiredNeedsDetailsUrlError`, `TooManyAnnotationsError(limit)`, `TooManyCheckRunsError(sha, name)`, `CheckRunNotFoundError`, `CheckSuiteNotFoundError`, `ChecksNeedInstallationError` (a 403), `NotRunOwnerError` (a 403), `CheckAppGoneError` (a 422).

- [ ] **Step 1: Write failing tests.** Cover:
  - each conclusion's `rollupState`;
  - `queued` and `in_progress` give `pending`;
  - `suiteState([])` gives `queued`;
  - one started, one queued gives `in_progress`;
  - none started gives `queued`;
  - the precedence, with a table test pairing each conclusion with `success`;
  - **an old failure plus a newer success with the same name gives `success`** (Review Focus 1);
  - each `resolveRunWrite` implication and error.
- [ ] **Step 2: Run to confirm they fail.** Run `cd apps/api && bunx vitest run src/lib/checks`. Expect FAIL: module not found.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to confirm they pass.** Run the same command. Expect PASS.
- [ ] **Step 5: Commit.** `feat(checks): rollup, suite state and run write rules`

### Task 4: Shared commit-holder rule

**Files:**
- Create: `apps/api/src/services/git/commit-holder/commit-holder.service.ts`
- Modify: `apps/api/src/resources/commit-statuses/commit-statuses.service.ts` (delete private `holdsCommit`; inject the new service), `commit-statuses.module.ts` (provide it)

**Interfaces:**
- Produces: `CommitHolderService.holds(repository: { id: string; defaultBranch: string | null }, sha: string): Promise<boolean>`. The body moves unchanged from `CommitStatusesService.holdsCommit`, with its `ponytail:` comment.

- [ ] **Step 1: Move the method.** Pure refactor; no new test.
- [ ] **Step 2: Run the existing tests.** Run `bunx vitest run src/resources/commit-statuses` and `bunx vitest run --config ./vitest.config.e2e.ts test/github-statuses.e2e-spec.ts`. Expect PASS, unchanged.
- [ ] **Step 3: Commit.** `refactor: share the commit-holder rule`

### Task 5: ChecksService: runs, suites, annotations

**Files:**
- Create:
  - `apps/api/src/resources/checks/checks.service.ts`
  - `apps/api/src/resources/checks/checks.module.ts` (imports `CommitStatusesModule` for `CommitHolderService`, or provides it directly)
  - `apps/api/src/resources/checks/dto/check.dto.ts`
- Test: `apps/api/src/resources/checks/checks.integration.spec.ts`. Copy the setup of `commit-statuses.integration.spec.ts`: a real repo, `PushTransactionService` on `InMemoryWalStore`. Seed an `app` and an `appInstallation` row directly.

**Interfaces:**
- Consumes: Task 3's rules and errors, `CommitHolderService.holds`, `RepositoryAccessService.authorize`, `publishEvent`.
- Produces:
  - `type ChecksCaller = { requesterId: string; installation: { installationId: string; appId: string; permissions: AppPermissions } | null }`
  - `type RepositoryRef = { username: string; repo: string }`
  - `CheckRunDTO`:
    - `id`, `name`, `headSha`, `status`, `conclusion`
    - `startedAt`, `completedAt` (ISO or null), `externalId`, `detailsUrl`
    - `output: { title, summary, text, annotationsCount }`
    - `actions: { label, description, identifier }[]`
    - `app: { slug, name, image, deleted: boolean }`
    - `suiteId`, `createdAt`, `updatedAt`
  - `CheckSuiteDTO`: `id`, `headSha`, `headBranch`, `status`, `conclusion`, `before`, `after`, `app`, `runsCount`, `createdAt`, `updatedAt`.
  - `CheckAnnotationDTO`: `path`, `startLine`, `endLine`, `startColumn`, `endColumn`, `annotationLevel`, `message`, `title`, `rawDetails`.
  - `ChecksService` methods:
    - `createRun(target: RepositoryRef & ChecksCaller, body: CreateCheckRunInput): Promise<CheckRunDTO>`
    - `updateRun(target, runId: string, body: UpdateCheckRunInput): Promise<CheckRunDTO>`
    - `getRun(target: RepositoryRef & { requesterId?: string }, runId): Promise<CheckRunDTO>`
    - `runsForRef(target, ref: string, query: { checkName?: string; status?: CheckStatus; filter: 'latest' | 'all'; appId?: string; offset: number; limit: number }): Promise<{ sha: string; runs: CheckRunDTO[]; total: number }>`
    - `annotations(target, runId, { offset, limit }): Promise<{ annotations: CheckAnnotationDTO[]; total: number }>`
    - `createSuite(target & ChecksCaller, headSha: string): Promise<CheckSuiteDTO>` (idempotent per app)
    - `getSuite(target, suiteId)`
    - `suitesForRef(target, ref, { appId?, checkName?, offset, limit })`
    - `runsOfSuite(target, suiteId, query)`
    - `latestRunsFor(repositoryIds: string[], shas: string[]): Promise<Map<string, CheckRunDTO[]>>`, the newest per (app, name). Callers authorize, as with `combinedFor`.
  - `CreateCheckRunInput`, `UpdateCheckRunInput`: camelCase versions of GitHub's body (`name`, `headSha`, `detailsUrl`, `externalId`, `status`, `conclusion`, `startedAt`, `completedAt`, `output { title, summary, text?, annotations? }`, `actions?`). Validated with zod at the controller boundary using the limits.

Behaviour, following spec "Permissions", "Lifecycle and validation" and "Limits":
- **Who may write.** Writes need `installation` with `checks: write`; otherwise `ChecksNeedInstallationError`. Updating needs the run's suite `appId === installation.appId`; otherwise `NotRunOwnerError`.
- **Creating a run** finds or creates the app's suite for the sha, then inserts the run. It counts runs per (repository, sha, name) against `MAX_RUNS_PER_NAME`, with the same `ponytail:` race note as statuses. It appends annotations, then recomputes and stores the suite state, all in one transaction.
- **Events.**
  - `check_run.created` on insert.
  - `check_run.completed` the first time `status` becomes `completed` (the `completedOnce` flag).
  - `check_suite.completed` whenever the stored suite status moves to `completed` from anything else.
- **Updates** replace the given output fields and append annotations, checking `MAX_ANNOTATIONS_PER_RUN` with a count inside the transaction. `actions`, when given, replace the old ones.

- [ ] **Step 1: Write failing integration tests.** Each is an `it` in `checks.integration.spec.ts`:
  - `"an installation with checks: write creates a queued run in a new suite"`. Asserts `status: 'queued'`, `startedAt` set, one suite, the suite `queued`, and a `check_run.created` outbox row.
  - `"refuses a caller without an installation"` → `ChecksNeedInstallationError`. Also `"refuses an installation with only checks: read"`.
  - `"refuses a sha the repository does not hold"` → `InvalidStatusShaError`, or a new `InvalidCheckShaError` if the message must differ.
  - `"conclusion implies completed and fires check_run.completed once"`. PATCH twice with conclusions: one `check_run.completed` row (Review Focus 3).
  - `"another app cannot update the run"` → `NotRunOwnerError`.
  - `"annotations append across updates and stop at 1000"`. 20 PATCHes × 50 work; the next one throws `TooManyAnnotationsError`.
  - `"suite completes when its newest runs complete, and again after a re-run"`. `check_suite.completed` fires twice across: fail, a new run queued, then success. The suite conclusion ends `success`.
  - `"filter=latest returns the newest per app and name"`.
  - `"latestRunsFor spans repositories, first repository wins per app and name"`. This mirrors the `combinedFor` fork rule.
- [ ] **Step 2: Run to confirm they fail.** Run `TEST_DATABASE_URL=… bunx vitest run src/resources/checks`. Expect FAIL.
- [ ] **Step 3: Implement** `ChecksService`. Select DTO fields straight from the query (no `toXDTO`); the app columns come from a join with `app`.
- [ ] **Step 4: Run to confirm they pass.** Run the same command. Expect PASS.
- [ ] **Step 5: Commit.** `feat(checks): check runs, suites and annotations`

### Task 6: Re-run, re-request and actions

**Files:**
- Modify: `apps/api/src/resources/checks/checks.service.ts`
- Test: `checks.integration.spec.ts`

**Interfaces:**
- Produces:
  - `rerequestRun(target: RepositoryRef & ChecksCaller, runId): Promise<void>`
  - `rerequestSuite(target, suiteId): Promise<void>`
  - `requestAction(target: RepositoryRef & { requesterId: string }, runId, identifier: string): Promise<void>`

Behaviour:
- **Who may call.** A user with write access may call all three. An installation may re-request only its own app's runs and suites (spec "Permissions").
- **Gone apps.** A run whose app is deleted, or whose installation is gone or suspended, throws `CheckAppGoneError` (Review Focus 5).
- **Unknown action.** An identifier not in the run's `actions` throws a 422 `UnknownCheckActionError`.
- **Events.** Each call publishes one event (`check_run.rerequested`, `check_suite.rerequested` or `check_run.requested_action` with `identifier`) and changes no stored state.

- [ ] **Step 1: Write failing tests:**
  - `"a writer re-runs a run: one check_run.rerequested, run unchanged"`
  - `"a reader cannot re-run"` → `RepositoryForbiddenError`
  - `"another app's installation cannot re-request"`
  - `"re-run on a deleted app's run is refused"`
  - `"pressing an action sends its identifier"`
  - `"an unknown identifier is refused"`
- [ ] **Step 2: Run to confirm they fail.** Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to confirm they pass.** Expect PASS.
- [ ] **Step 5: Commit.** `feat(checks): re-run, re-request and action buttons`

### Task 7: Delivering check events

**Files:**
- Modify: `apps/api/src/services/webhooks/webhook-fanout.service.ts`
- Modify: `apps/api/src/lib/webhooks/webhooks.ts` (body types), `apps/api/src/lib/webhooks/formats/*` (chat renderers for the three subscribable events)
- Test: the existing fanout spec beside the service (or `webhook-fanout.integration.spec.ts`), plus the formats spec

**Interfaces:**
- Consumes: `OWNING_APP_EVENTS` (Task 1) and the event payloads (Task 1).
- Produces: in `handle()`, an event whose type is in `OWNING_APP_EVENTS` skips the normal endpoint query. It goes to `owningAppDelivery(event)`, which loads the run's or suite's installation. That installation must be live, not suspended, hold `checks`, and have an active endpoint. The function enqueues one job with `installation: { id: numericId }`, whatever the app subscribed to. This is modelled on `installationEvent`. Subscribable check events take the normal path.
- Body: `{ event, checkRun | checkSuite, repository, sender, installation?, requestedAction?: { identifier } }`.
  - `checkRun` is the `CheckRunDTO` without `output.text`; GitHub omits it from webhooks (verify).
  - `checkSuite` is the `CheckSuiteDTO`.

- [ ] **Step 1: Write failing tests:**
  - `"check_run.rerequested reaches only the owning app"`. Two apps are installed and both subscribe to everything; one job goes to the owner.
  - `"owning-app events never reach repository webhooks"`
  - `"check_run.created reaches a subscribed app with checks: read and a repository webhook"`
  - `"an app without checks gets no check events"`
  - The renderer test: the Discord embed for `check_run.completed` names app, run and conclusion.
- [ ] **Step 2: Run to confirm they fail.** Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to confirm they pass.** Expect PASS.
- [ ] **Step 5: Commit.** `feat(checks): deliver check events, owning-app events to their app only`

### Task 8: Automatic suites when a branch moves

**Files:**
- Create: `apps/api/src/lib/checks/request-check-suites.ts`
- Modify: `apps/api/src/services/git/wal/push-transaction.service.ts` (inject `DATABASE`; after `commitIndex` succeeds, call it without awaiting the result's failure)
- Test: `apps/api/src/services/git/wal/push-transaction.integration.spec.ts` (create if none), plus one e2e case in Task 9's spec for a web merge

**Interfaces:**
- Produces: `requestCheckSuites(db: Database, push: { repositoryId: string; transitions: RefTransition[]; actor: RefWriter }): Promise<void>`.
  - It does nothing for `actor === 'system'` (imports, repair and pull refs). Branch moves count only for `refs/heads/*` with a non-zero new oid, which leaves out tags and deletions.
  - For each moved branch, and each live, unsuspended installation covering the repository (`installationCovers`) whose permissions grant `checks: write`, it inserts the suite with `before` and `after`, on conflict do nothing. When a row was inserted, it publishes `check_suite.requested`.
  - `commitPush` calls it after a successful commit: `.catch` logs a warning and never rejects, as `recordPush` does, because the push already landed.

- [ ] **Step 1: Write failing tests:**
  - `"a user push to a branch requests a suite per installed app with checks: write"`
  - `"no suite for an app with only checks: read, a suspended installation, a tag, a deletion or a system write"`
  - `"pushing the same sha twice requests once"`
- [ ] **Step 2: Run to confirm they fail.** Expect FAIL.
- [ ] **Step 3: Implement.** Check that `commitPush` keeps one shape for all nine callers. They need no change, because the hook lives inside it.
- [ ] **Step 4: Run to confirm they pass.** Expect PASS. Then rerun `src/resources/commit-statuses`, `src/resources/branches` and the pull request merge integration specs. Expect PASS, unchanged.
- [ ] **Step 5: Commit.** `feat(checks): request a suite from installed apps when a branch moves`

### Task 9: GitHub REST compat

**Files:**
- Create:
  - `apps/api/src/github/rest/checks/checks.controller.ts`
  - `checks.service.ts`
  - `checks.module.ts` (register in `github.module.ts`)
  - `dto/check.dto.ts`
- Modify: `apps/api/src/lib/github/rest.ts` (`checkRunRest`, `checkSuiteRest` value builders next to `toStatusRest`, if the standards allow those as value conversion; otherwise build them in the service where they are returned), `apps/api/src/lib/github/node-lookup.ts` (numeric id ↔ id for runs and suites)
- Test: `apps/api/test/github-checks.e2e-spec.ts`, using `@octokit/app` as `app-attribution.e2e-spec.ts` does

**Interfaces:**
- Consumes: every `ChecksService` method from Tasks 5–6.
- Produces: the routes in spec "GitHub REST", under `@RequireAppPermission('checks')` on the controller, with `GithubRestFilter` and `GithubRestInterceptor`.
  - Ids on the wire are `numericId`.
  - The wildcard ref routes use `commits/*ref/check-runs` and `commits/*ref/check-suites`, like statuses.
  - `PATCH /check-suites/preferences` is not registered, so it 404s.
  - `output.images` is accepted by the DTO and dropped (spec "Non-goals"). Test it: a body carrying images succeeds.
  - The run's `app` uses the compat layer's existing app object.
  - `check_suite` inside a run is `{ id }`.
  - `output.annotations_url` and `url`/`html_url` use `githubOrigins`.

- [ ] **Step 1: Write failing e2e tests.** Each case uses Octokit with an installation token:
  - create a run, PATCH it to completed with 2 annotations, GET it, list annotations; the bodies match GitHub's documented field names
  - `GET commits/main/check-runs` with `filter=latest` and `filter=all`, `check_name`, `status`
  - `GET commits/main/check-suites?app_id=`
  - create a suite explicitly; re-request a suite; re-request a run
  - **refusals:** a PAT POST gets 403; a `ghu_` token POST gets 403; an installation without `checks` gets 403 `Resource not accessible by integration`; another app's PATCH gets 403
  - 422 for 51 annotations, 4 actions, a name of 256 chars, and completed without a conclusion
  - **a web merge of a pull request requests a suite** (Task 8 through the real merge path)
- [ ] **Step 2: Run to confirm they fail.** Run `bunx vitest run --config ./vitest.config.e2e.ts test/github-checks.e2e-spec.ts`. Expect FAIL with 404s.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to confirm they pass.** Expect PASS.
- [ ] **Step 5: Commit.** `feat(checks): GitHub check runs and suites REST`

### Task 10: One rollup for statuses and runs, and rulesets

**Files:**
- Create: `apps/api/src/resources/checks/commit-checks.service.ts`
- Modify:
  - `resources/pull-requests/pull-requests.service.ts` and its `dto/pull-request.dto.ts` (`checks: CommitChecksDTO | null`)
  - `resources/repositories/repositories.service.ts` and its `dto/get-repository-commits.dto.ts` (commit `status` becomes `checks: CommitChecksDTO | null`)
  - `services/rulesets/ruleset-verdicts.service.ts`, the merge facts in `pull-requests.service.ts:1029` and `commit-statuses.service.ts` (`contexts()` unions `check_run.name`)
  - `lib/rulesets/rulesets.types.ts` (rename `RefFacts.statuses` to `RefFacts.checks` if it reads clearer; the shape is unchanged)
  - the modules that now import `ChecksModule`

**Interfaces:**
- Consumes: `CommitStatusesService.combinedFor`, `ChecksService.latestRunsFor`, `rollupState` and `combinedState`.
- Produces:
  - `CommitChecksDTO = { sha: string; state: CommitStatusState; statuses: CommitStatusDTO[]; checkRuns: CheckRunDTO[] }`. `state` is `combinedState` over the status states plus `rollupState` of each run.
  - `CommitChecksService.checksFor(repositoryIds: string[], shas: string[]): Promise<Map<string, CommitChecksDTO>>`. A sha with neither statuses nor runs is absent.
  - `CommitChecksService.requiredChecks(repositoryId: string, shas: string[]): Promise<Map<string, RefFacts['statuses']>>`. It replaces `CommitStatusesService.requiredCheckStatuses`; delete that method and move its query here. Statuses and runs are merged newest first. A run's time is `completedAt ?? updatedAt`, `context` is its name, the state comes from `rollupState`, and `appId` is the app's `numericId`.
  - `evaluate-rulesets.ts` is unchanged.

- [ ] **Step 1: Write failing tests.** Integration tests in `src/resources/checks/commit-checks.integration.spec.ts`:
  - `"state mixes statuses and runs"`: a status `success` plus a run in progress gives `pending`.
  - `"a re-run success replaces the old failure"` (Review Focus 1).
  - `"the same name from two apps shows both"` (Review Focus 2).
  - `"required checks: a run satisfies an unpinned check, a pinned check takes only its app"`.
  - `"neutral and skipped satisfy, action_required does not"`.
  - `"a deleted app's run still renders, and a check pinned to it stays unmet"` (Review Focus 5).

  E2e cases in `test/github-pull-request-rules.e2e-spec.ts` (or `app-rulesets.e2e-spec.ts`):
  - a merge is blocked until the CI app's run `build` succeeds;
  - a run posted on a fork does not satisfy the base's rule; one posted on the base for the fork's head sha does (Review Focus 4);
  - the ruleset form's suggestions include a run name.
- [ ] **Step 2: Run to confirm they fail.** Expect FAIL.
- [ ] **Step 3: Implement.** Switch every caller of `combinedFor` that feeds the web (PR DTO, the commit list, the commit page) to `checksFor`. The GitHub REST `/status` keeps `combinedFor`.
- [ ] **Step 4: Run to confirm they pass.** Expect PASS. Then run the rulesets and statuses e2e suites. Expect PASS, unchanged.
- [ ] **Step 5: Commit.** `feat(checks): check runs in the commit rollup and required checks`

### Task 11: GraphQL

**Files:**
- Modify:
  - `apps/api/src/github/graphql/types/placeholders.type.ts` (move `CheckRun` and `CheckSuite` into a new `types/check.type.ts`; fix the header comment)
  - `resolvers/pull-request/pull-request.resolver.ts` and `pull-request-nodes.service.ts` (rollup from `checksFor`)
  - `lib/github/node-id.ts` and `node-lookup.ts` (`CheckRun`, `CheckSuite`)
  - `resolvers/viewer/viewer.service.ts` (`node(id:)`)
  - `lib/apps/graphql-permissions.ts` (`CheckRun`, `CheckSuite`, `CheckAnnotation`, `CheckRunConnection` and the rest under `checks: read`)
- Test: `apps/api/test/github-graphql.e2e-spec.ts`, plus a `gh pr checks` case in `test/gh-cli.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `CheckRun` fields:
    - `id`, `databaseId`, `name`, `status`, `conclusion`
    - `startedAt`, `completedAt`, `detailsUrl`, `title`, `summary`, `text`
    - `annotations(first, after)`, `checkSuite`, `isRequired(pullRequestNumber:)`
    - plus whatever gh's `pr checks` and `pr view --json statusCheckRollup` queries select; read them in `test/gh-capture`
  - `CheckSuite` fields: `id`, `databaseId`, `app { name slug }`, `status`, `conclusion`, `checkRuns(first, after)`, `workflowRun: null`.
  - `StatusCheckRollupNode.contexts`: `(CheckRunNode | StatusContextNode)[]`, ordered as GitHub does (verify; else runs then statuses). Its `state` comes from `CommitChecksDTO.state`. The rollup is null when there are neither runs nor statuses.

- [ ] **Step 1: Write failing tests:**
  - `gh pr checks` lists a status and a run with the right buckets (pass, fail, pending);
  - `gh pr checks --required` marks a required run;
  - `node(id:)` resolves a `CheckRun`;
  - an installation without `checks` is denied the `CheckRun` type;
  - the unmapped-type test passes.
- [ ] **Step 2: Run to confirm they fail.** Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to confirm they pass.** Expect PASS.
- [ ] **Step 5: Commit.** `feat(checks): CheckRun and CheckSuite in GraphQL and the status rollup`

### Task 12: Ghost REST API for the web

**Files:**
- Create: `apps/api/src/resources/checks/checks.controller.ts`
- Modify: `apps/web/src/lib/api/v1.d.ts` (regenerated)
- Test: `apps/api/test/checks.e2e-spec.ts`

**Interfaces:**
- Produces, under Ghost's `/api/v1` conventions (copy `commit-statuses.controller.ts` for prefix, auth and decorators):
  - `GET /repositories/:username/:repo/check-runs/:id/annotations?offset&limit`
  - `GET /repositories/:username/:repo/pull-requests/:number/annotations`: newest runs on the head sha only, as `{ path: string; annotations: (CheckAnnotationDTO & { run: { id, name, app: { slug, name } } })[] }[]`
  - `POST …/check-runs/:id/rerequest`, `POST …/check-suites/:id/rerequest`, `POST …/check-runs/:id/actions/:identifier`. Each answers 204.
  - `CheckRunDTO` gains `viewerCanRerun: boolean`: write access, and the app is not gone.

- [ ] **Step 1: Write failing e2e tests:**
  - a reader gets annotations, but 403 on rerequest;
  - a writer's rerequest queues the delivery;
  - the PR annotations come grouped by path, from newest runs only;
  - `viewerCanRerun` is false for a deleted app's run.
- [ ] **Step 2: Run to confirm they fail.** Expect FAIL.
- [ ] **Step 3: Implement.** Regenerate the OpenAPI types against the throwaway DB.
- [ ] **Step 4: Run to confirm they pass.** Expect PASS. `cd apps/web && bunx tsc --noEmit` compiles once the web callers are updated in Task 13. If this commit must compile alone, update the type imports now.
- [ ] **Step 5: Commit.** `feat(checks): Ghost API for annotations, re-runs and actions`

### Task 13: Web: merge panel and commit list

**Files:**
- Modify:
  - `apps/web/src/components/repositories/commit-checks.tsx` (takes `CommitChecksDTO`; adds the `CheckRunRow` family)
  - `apps/web/src/components/repositories/commit-list.tsx`
  - `app/[username]/[repo]/pull/[number]/merge-panel.tsx`
  - `app/[username]/[repo]/commit/[hash]/page.tsx`
  - `app/[username]/[repo]/pull/[number]/commits/[sha]/page.tsx`
  - `apps/web/src/app/changelog/entries.ts` (one entry)
- Create: a server action file beside `merge-panel.tsx` for rerun, rerun-all and action (follow how `merge-button.tsx` posts)

**Interfaces:**
- Produces:
  - `CommitChecks({ checks: CommitChecksDTO | null; required?: string[]; className? })`. The summary counts statuses and runs together. Failing rows sort first. The panel stays open while the state is not `success`.
  - `CheckRunIcon({ status, conclusion })`:
    - queued: `CircleDashed`
    - in progress: `Loader` spinning, honouring `motion-reduce`
    - passing: `CircleCheck`
    - neutral and skipped: `CircleSlash` (muted)
    - failing: `CircleX`
  - `CheckRunRow({ run, required, canRerun })`: a `<details>` row showing "app / name", the Required badge and `output.title`. The expanded body has:
    - the summary and text through the existing markdown renderer
    - annotations as `path:line` plus the message (a "Show N more" link fetches the page from Task 12)
    - Re-run and the action buttons when `viewerCanRerun`
    - "Details ↗" for `detailsUrl`
  - "Re-run all" beside each app's first row when any of its runs has `viewerCanRerun`.

- [ ] **Step 1: Build the components.** Wire the PR, commit and commit-list pages to them.
- [ ] **Step 2: Type-check and lint.** Run `cd apps/web && bunx tsc --noEmit && bun lint`. Expect clean.
- [ ] **Step 3: Check in the browser.** Use the user's Chrome at `localhost:3000` (memory: ui-testing-chrome), on the dev DB, after migrating it with the user's OK. Seed runs through Octokit with a dev installation. Check:
  - a failing run expands;
  - Re-run queues a delivery;
  - the tick on main opens the same list;
  - a mirrored-style run with `details_url` links out;
  - the page works at phone width and in dark mode.
- [ ] **Step 4: Commit.** `feat(web): check runs in the merge panel and commit list`

### Task 14: Web: annotations on the Files tab

**Files:**
- Modify: `app/[username]/[repo]/pull/[number]/files/page.tsx` (fetch the PR annotations), `files/review-diff.tsx` (render them under their line)
- Create: `apps/web/src/components/pull-requests/check-annotation.tsx`

**Interfaces:**
- Consumes: `GET …/pull-requests/:number/annotations` (Task 12).
- Produces: `CheckAnnotation({ annotation })`, a block coloured by level (failure red, warning amber, notice blue, using theme tokens). It is labelled "app / run name", with the title and message, and `rawDetails` in a `<details>`. It renders under `endLine` on the new side when that line is in the diff. Otherwise it is not shown here; it stays in the run's expanded output.

- [ ] **Step 1: Build.**
- [ ] **Step 2: Type-check and lint.** Run `bunx tsc --noEmit && bun lint`. Expect clean.
- [ ] **Step 3: Check in the browser.** Use the PR seeded in Task 13. An annotation on a changed line shows; one on an unchanged line doesn't. Check dark mode too.
- [ ] **Step 4: Commit.** `feat(web): check annotations on the pull request diff`

### Task 15: Whole-branch verification

- [ ] **Step 1: Run everything.** On throwaway backends, run:
  - `bun test` in `packages/permissions` and `packages/webhooks`;
  - `cd apps/api && bunx vitest run` and `bunx vitest run --config ./vitest.config.e2e.ts`;
  - `cd apps/web && bunx tsc --noEmit && bun lint`.

  Expect PASS, apart from the known fork-quota e2e failure.
- [ ] **Step 2: Walk the spec.** Go section by section and tick each requirement against a test or a commit. Note every "verify" item that was or was not checked against GitHub.
- [ ] **Step 3: Leave the PRs for the user.** Do not open them; the user decides (dual PR workflow, memory).
