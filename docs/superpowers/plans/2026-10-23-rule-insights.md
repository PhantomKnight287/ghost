# Rule insights and evaluate mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every ruleset-checked write as a rule suite, add `evaluate` enforcement, and show suites to admins in Settings › Rules › Insights and through GitHub's `rule-suites` REST endpoints.

**Architecture:** The pure evaluator grows a per-ref `suites` output (every rule checked, pass or fail, active and evaluate). A new `RuleSuitesService` wraps each user write: it refuses and records `fail` on violations, or runs the write and records `pass`/`bypass` once it lands. Reads go through the same service; the Ghost API pages by keyset, the GitHub layer by `page`/`per_page`.

**Tech Stack:** NestJS, Drizzle (Postgres), vitest (unit + e2e), Next.js app router, openapi-fetch.

**Spec:** `docs/superpowers/specs/2026-10-23-rule-insights-design.md`

## Global Constraints

- Follow `docs/code-standards.md` in every file: no `to<Format>` reshaping helpers, one-line comments and strings, comments only for why, `services/` holds only `@Injectable()` classes (pure code in `lib/`), controllers pass and services do, no one-or-two-line helpers, every fetching route has `loading.tsx`.
- Never hand-edit SQL migrations: change `packages/db/src/schema/*.ts`, then run `bun db:generate` at the repo root.
- After any API DTO/route change run `bun run openapi` at the root (regenerates `apps/api/openapi.json` and `apps/web/src/lib/api/v1.d.ts`).
- e2e runs only against throwaway containers (Postgres `postgres:16-alpine` on 55433, `rustfs/rustfs` on 59000), Node 22: `PATH=$HOME/.nvm/versions/node/v22.23.4/bin:$PATH TEST_DATABASE_URL=postgres://postgres:test@localhost:55433/postgres TEST_S3_ENDPOINT=http://localhost:59000 npx vitest run --config ./vitest.config.e2e.ts --no-file-parallelism <files>` from `apps/api`.
- Do not commit (user's instruction for this work). "Checkpoint" steps below mean: run the task's tests and `bunx tsc --noEmit -p apps/api/tsconfig.json`, nothing else.
- `RuleSuitesService.attempt` is the only place a rule suite is written.
- Enforcement-driving code keeps reading `active` rulesets only: `allowedMergeMethods`, merge requirements display, `reviewsRequired`, stale approvals, `protectedRefs`, GitHub `branchRules`, GraphQL loaders.

## Review Focus

1. A merge page refresh, `merge-requirements`, `gh pr view`/`gh pr status` must create no suite — e2e in Task 3.
2. A push to a ref only an evaluate ruleset targets, with a `non_fast_forward` rule, must not report a false `fail` from missing facts — unit in Task 1 and e2e in Task 2 (force-push recorded as evaluate `fail`, normal push `pass`).
3. A ruleset renamed or deleted after a suite was recorded: old suites keep the old name; deleted reads `deleted ruleset` — e2e in Task 4/5.
4. `rule-suites` must not be swallowed by `rulesets/:id` (its numeric pipe 404s on `rule-suites`) — e2e in Task 5.
5. A refused multi-ref push records one suite per targeted ref (passing refs `pass`) and none for untargeted refs — e2e in Task 3.

---

### Task 1: Evaluator reports every rule; `evaluate` enforcement in the evaluator

**Files:**
- Modify: `packages/db/src/schema/rulesets.ts` (enum value)
- Modify: `apps/api/src/lib/rulesets/rulesets.types.ts`
- Modify: `apps/api/src/lib/rulesets/evaluate-rulesets.ts`
- Test: `apps/api/src/lib/rulesets/evaluate-rulesets.spec.ts`

**Interfaces:**
- Produces (in `rulesets.types.ts`):
  ```ts
  export type RuleSuiteResult = 'pass' | 'fail' | 'bypass';
  export type RuleEvaluation = {
    rulesetId: string;
    rulesetName: string;
    enforcement: 'active' | 'evaluate';
    rule: RuleType;
    result: 'pass' | 'fail';
    /** Unmet requirements of a failed `pull_request` rule, in the evaluator's order; empty otherwise. */
    requirements: Requirement[];
    details: string | null;
  };
  export type RuleSuiteVerdict = {
    transition: RefTransition;
    result: RuleSuiteResult;
    evaluationResult: RuleSuiteResult | null;
    evaluations: RuleEvaluation[];
  };
  export type RulesetEvaluation = { violations: Violation[]; bypassed: Violation[]; suites: RuleSuiteVerdict[] };
  ```
- `evaluateRulesets` keeps its signature; `rulesets` may now contain `evaluate` rulesets.

- [ ] **Step 1: Add `'evaluate'` to `rulesetEnforcement` in `packages/db/src/schema/rulesets.ts`** (order: `active`, `evaluate`, `disabled`), then `bun db:generate` at root. Expect one new `ALTER TYPE ... ADD VALUE 'evaluate'` migration.

- [ ] **Step 2: Write failing unit tests** in `evaluate-rulesets.spec.ts`, `describe('suites')`:
  - `lists every rule of each targeting ruleset, passing ones included`: active ruleset `[creation, deletion, non_fast_forward]`, fast-forward update of `refs/heads/main` → one suite, `evaluations.map(e => [e.rule, e.result])` equals `[['creation','pass'],['deletion','pass'],['non_fast_forward','pass']]`, `result: 'pass'`, `evaluationResult: null`.
  - `no suite for a ref no ruleset targets`: transitions on `main` and `feature`, ruleset targets `main` → `suites.map(s => s.transition.ref)` equals `['refs/heads/main']`.
  - `a failed pull_request rule is one evaluation holding every unmet requirement`: merge with 0 of 1 approvals and unresolved threads → one `pull_request` evaluation, `requirements: ['approvals','threads']`, `details` equal to the two messages joined with `'\n'`.
  - `pull_request rule on a create or delete is a pass`.
  - `bypassed failure makes the suite bypass`: admin bypass `always`, `update` rule → `result: 'bypass'`, `bypassed` has it, `violations` empty.
  - `evaluate ruleset never refuses`: evaluate ruleset with `update` → `violations` and `bypassed` empty, evaluation `{ enforcement: 'evaluate', result: 'fail' }`, suite `result: 'pass'`, `evaluationResult: 'fail'`.
  - `bypass lists do not apply to evaluate rulesets`: actor with `always` bypass on an evaluate ruleset that fails → `evaluationResult: 'fail'`.
  - `evaluationResult counts active failures too`: active `update` (not bypassable) + evaluate passes → `result: 'fail'`, `evaluationResult: 'fail'`; active bypassed + evaluate passes → `'bypass'`/`'bypass'`.
  - `disabled rulesets are not evaluated`: no evaluations, no suite.
  - `existing violations and bypassed are unchanged`: existing tests still pass untouched.

- [ ] **Step 3: Run** `cd apps/api && bunx vitest run src/lib/rulesets/evaluate-rulesets.spec.ts` → new tests FAIL (`suites` undefined).

- [ ] **Step 4: Implement in `evaluate-rulesets.ts`.** Evaluate `active` and `evaluate` rulesets (skip `disabled`). Per ruleset × targeted transition × rule, push a `RuleEvaluation` into that transition's suite (keyed by `transition.ref`, created on first evaluation, in transition order). Only `active` failures go to `violations`/`bypassed` as today. Suite results:
  ```ts
  result = activeFails.some(not bypassable) ? 'fail' : activeFails.length ? 'bypass' : 'pass';
  evaluationResult = !hasEvaluate ? null : (result === 'fail' || evaluateFails.length) ? 'fail' : result;
  ```
  `details`: `MESSAGES[rule]` for a failed non-PR rule; for `pull_request`, the unmet messages joined by `'\n'`.

- [ ] **Step 5: Run** the spec → PASS. Checkpoint.

### Task 2: `evaluate` everywhere enforcement appears; verdicts carry suites

**Files:**
- Modify: `apps/api/src/services/rulesets/ruleset-verdicts.service.ts`
- Modify: `apps/api/src/services/rulesets/pull-request-rules.service.ts:61-88`
- Modify: `apps/api/src/resources/pull-requests/pull-requests.service.ts` (`judgeMerge` `reviewsRequired`)
- Modify: `apps/api/src/git/git.service.ts:303`
- Modify: `apps/api/src/github/graphql/enums.ts:233` (`EVALUATE = 'EVALUATE'`), regenerate `apps/api/github.schema.gql` the way it is generated today
- Modify: `apps/web/src/components/rulesets/ruleset-form.tsx:39-40`, `apps/web/src/app/[username]/[repo]/settings/rules/ruleset-list.tsx:85`
- Test: `apps/api/test/rulesets-enforcement.e2e-spec.ts`, `apps/api/test/github-rulesets.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  - `RulesetVerdict = { transitions; violations; bypassed; suites: RuleSuiteVerdict[]; write: 'push' | 'pull_request_merge' }` (`write` copied from `judge`'s argument; `suites: []` when nothing applies).
  - `RulesetVerdictsService.enforced(repositoryId: string, target?: Ruleset['target']): Promise<Ruleset[]>` — `active` and `evaluate`. `active()` stays for enforcement-only readers. `judge` defaults to `enforced`.
  - `PullRequestRulesService.applicable` loads `enforced` when not given rulesets; its `pullRequestRules` keep evaluate rulesets (their facts are needed); `allowedMethods` unchanged (already skips non-active).

- [ ] **Step 1: Write failing e2e tests.**
  - `rulesets-enforcement.e2e-spec.ts`: `an evaluate ruleset blocks nothing`: evaluate ruleset with `update` + `non_fast_forward` on `main`; a normal push and a force-push to `main` both succeed with no GH013 and no bypass notice.
  - `rulesets-enforcement.e2e-spec.ts`: `an evaluate pull_request rule leaves merging alone`: evaluate ruleset with `pull_request` (`required_approving_review_count: 1`, `allowed_merge_methods: ['squash']`) on the base; `merge-requirements` reports no violations and all three methods; a `merge`-method merge succeeds.
  - `github-rulesets.e2e-spec.ts`: REST create with `enforcement: 'evaluate'` round-trips; GraphQL `repository.rulesets.nodes.enforcement` reads `EVALUATE`.
- [ ] **Step 2: Run** those files → new tests FAIL (enum rejected / pushes refused).
- [ ] **Step 3: Implement** the interfaces above. `git.service` `commitToLog` loads `enforced` so `factsFor` covers evaluate rulesets' `non_fast_forward`/`required_linear_history`. `judgeMerge`'s `reviewsRequired` considers only `ruleset.enforcement === 'active'`. `mergeRequirements` keeps `verdicts.active` (display judges active only). Web: `enforcements = ["active", "evaluate", "disabled"]`, label `"Evaluate"`, hint under the field `Records what would pass or fail without blocking anything.` shown when evaluate is selected; list badge `Evaluate` like `Disabled`.
- [ ] **Step 4: Run** the two files plus `pull-request-rules.e2e-spec.ts`, `rulesets.e2e-spec.ts` → PASS. Checkpoint.

### Task 3: Record rule suites on every write

**Files:**
- Modify: `packages/db/src/schema/rulesets.ts` (tables, enums), then `bun db:generate`
- Create: `apps/api/src/services/rulesets/rule-suites.service.ts`
- Modify: `apps/api/src/services/rulesets/` module wiring (wherever `RulesetVerdictsService` is provided and exported)
- Modify write sites: `apps/api/src/git/git.service.ts` (`commitToLog`), `apps/api/src/resources/pull-requests/pull-requests.service.ts` (merge), `apps/api/src/resources/pull-requests/reviews.service.ts` (apply suggestion), `apps/api/src/resources/branches/repository-branches.service.ts`, `apps/api/src/resources/releases/releases.service.ts` (tag create, tag delete)
- Test: `apps/api/test/rule-insights.e2e-spec.ts` (new)

**Interfaces:**
- Schema (`packages/db/src/schema/rulesets.ts`):
  ```ts
  export const ruleSuiteResult = pgEnum('rule_suite_result', ['pass', 'fail', 'bypass']);
  export const ruleEvaluationResult = pgEnum('rule_evaluation_result', ['pass', 'fail']);
  export const ruleSuiteWrite = pgEnum('rule_suite_write', ['push', 'pull_request_merge']);
  ruleSuite: id text pk `rulesuite_${createId()}`, numericId bigint identity unique (same comment as ruleset's), repositoryId → repository cascade, actorId → user set null (nullable), actorName text (nullable), ref text, beforeSha text, afterSha text, write ruleSuiteWrite, pullRequestId → pullRequest.id set null (nullable), result ruleSuiteResult, evaluationResult ruleSuiteResult (nullable), createdAt timestamptz default now; index (repositoryId, createdAt, id).
  ruleEvaluation: id text pk `ruleeval_${createId()}`, ruleSuiteId → ruleSuite cascade, position integer, rulesetId → ruleset set null (nullable), rulesetName text, enforcement rulesetEnforcement, ruleType rulesetRuleType, result ruleEvaluationResult, requirements text[] default [], details text (nullable); index (ruleSuiteId, position), index (rulesetId).
  ```
- Produces:
  ```ts
  @Injectable() export class RuleSuitesService {
    /** Refuses with `refusal` (default RulesetViolationError) and records `fail` when the verdict found violations; otherwise runs `write` and records once it lands. A write that throws records nothing. */
    attempt<T>(context: { repositoryId: string; actorId: string | null; verdict: RulesetVerdict; pullRequestId?: string; refusal?: DomainError }, write: () => Promise<T>): Promise<T>;
  }
  ```
  Recording: one `ruleSuite` per `verdict.suites` entry plus its evaluations, in one transaction on `this.db` (never the caller's), `actorName` read from the user row at record time; a recording error is logged with `logger.warn` and swallowed. No suites → no query.

- [ ] **Step 1: Write failing e2e tests** in `test/rule-insights.e2e-spec.ts` (copy the harness setup of `pull-request-rules.e2e-spec.ts`: accounts, `pushAs`, `commitOn`, `requireOn`-style ruleset creation). Read suites straight from the DB with a `suitesOf(ref)` helper selecting suites + evaluations ordered by `createdAt`. Tests:
  - `a passing push records pass with every rule`: ruleset `[non_fast_forward]`, fast-forward push → one suite, `write: 'push'`, `result: 'pass'`, before/after SHAs, `actorId` and `actorName`.
  - `a refused push records fail with the message the pusher saw` (`update` rule) → `fail`, evaluation `details: 'Cannot update this protected ref'`.
  - `a bypassed push records bypass` (admin bypass `always`).
  - `a refused multi-ref push records each targeted ref and skips the rest` (push `main` (refused) + `protected-2` (passes) + `free` (untargeted) → suites for `main` `fail`, `protected-2` `pass`, none for `free`).
  - `a push no ruleset targets records nothing`.
  - `branch create and delete through the API are recorded`, `a release tag is recorded`, `applying a suggestion is recorded`.
  - `a refused merge records fail with the pull request` and `a merge that lands records pass with the pull request` (`write: 'pull_request_merge'`, `pullRequestId`).
  - `a merge over bypassable rules without bypassRules records nothing; with it, bypass`.
  - `merge requirements, the merge box and gh views record nothing`: call `GET pulls/:n/merge-requirements` twice, GraphQL `pullRequest { mergeStateStatus reviewDecision }`, REST `GET pulls/:n` → zero suites.
  - `a write that passes the rules but loses to a stale old sha records nothing` (API branch delete with a stale sha, or push with wrong old oid via `git push --force-with-lease=<ref>:<wrong>`).
  - `an evaluate force-push is recorded as evaluate fail` (Review Focus 2).
- [ ] **Step 2: Run** → FAIL (no tables / no rows).
- [ ] **Step 3: Schema + `bun db:generate`**; implement `RuleSuitesService.attempt`.
- [ ] **Step 4: Wire every write site** through `attempt`, deleting each site's own `if (verdict.violations.length > 0) throw new RulesetViolationError(...)`:
  - `git.service`: inside `withVerifiedPack`, `return this.ruleSuites.attempt({ repositoryId, actorId: pushedBy, verdict }, () => this.quota.reserve(...).catch(...))`.
  - merge: `refusal` is `new MergeMethodNotAllowedError(methodRefused.message)` when `params.compat && methodRefused`; the bypass-required check runs before `attempt` and only when `verdict.violations.length === 0`; `attempt` wraps the whole `withTempDir(...)` so the draft/quota re-checks inside record nothing when they throw.
  - suggestion, branches, release tag create/delete: `const verdict = await this.verdicts.judge(...)` then `attempt({ ..., verdict }, () => this.pushTransaction.commitPush({ ..., actor: { userId, verdict } }))`.
- [ ] **Step 5: Run** `rule-insights.e2e-spec.ts` plus `rulesets-enforcement`, `pull-request-rules`, `review-threads`, `pull-request-reviews`, `gh-cli`-free API suites touching these paths (`releases`, `branches` e2e if present) → PASS. Checkpoint.

### Task 4: Ghost API for the Insights page

**Files:**
- Create: `apps/api/src/lib/rulesets/rule-suite-filter.ts` (pure: filters → Drizzle `SQL`)
- Modify: `apps/api/src/services/rulesets/rule-suites.service.ts` (`list`, `get`)
- Create: `apps/api/src/resources/rulesets/rule-suites.controller.ts`, `apps/api/src/resources/rulesets/dto/rule-suite.dto.ts`; register in `rulesets.module.ts`
- Test: `apps/api/test/rule-insights.e2e-spec.ts` (`describe('api')`)

**Interfaces:**
- `lib/rulesets/rule-suite-filter.ts`:
  ```ts
  export const RULE_SUITE_PERIODS = ['hour', 'day', 'week', 'month', 'all'] as const;
  export type RuleSuiteFilters = { repositoryId: string; rulesetId?: string; ref?: string; actorName?: string; result?: RuleSuiteResult; enforcement?: 'active' | 'evaluate'; period: (typeof RULE_SUITE_PERIODS)[number] };
  export function ruleSuiteFilter(filters: RuleSuiteFilters, now: Date): SQL;
  ```
  `ref` without `refs/` matches `refs/heads/<ref>` or `refs/tags/<ref>`; `rulesetId`/`enforcement` match suites with an evaluation of that ruleset/enforcement (`exists`); `period: 'all'` adds no time bound.
- `RuleSuitesService`:
  ```ts
  list(params: RepositoryRef & { filters: Omit<RuleSuiteFilters, 'repositoryId'>; cursor?: string; limit: number }): Promise<{ ruleSuites: RuleSuiteDTO[]; nextCursor: string | null }>;
  get(params: RepositoryRef & { numericId: number }): Promise<RuleSuiteDTO>;
  ```
  Both `access.authorize({ ...target, operation: 'admin' })`. Keyset on `(createdAt, id)` desc via `lib/db/keyset.ts`. Evaluations loaded in one query for the page, ordered by `position`; `enforcement` reads `'deleted ruleset'` when `rulesetId` is null. The select produces `RuleSuiteDTO` fields directly (no reshaping helper).
- `RuleSuiteDTO`: `{ id: string; numericId: number; actor: { id: string; username: string } | null; actorName: string | null; ref: string; beforeSha: string; afterSha: string; write: 'push' | 'pull_request_merge'; pullRequest: { number: number } | null; result; evaluationResult; createdAt: string; evaluations: { rulesetId: string | null; rulesetName: string; enforcement: 'active' | 'evaluate' | 'deleted ruleset'; rule: RuleType; result: 'pass' | 'fail'; requirements: Requirement[]; details: string | null }[] }`.
- Route: `GET /api/repositories/:username/:repo/rule-suites?rulesetId&ref&actor&result&enforcement&period=day&cursor&limit` (repository-level path so it cannot collide with `rulesets/:id`). `period` defaults to `day`, `limit` defaults to the repo's `DEFAULT_PAGE_SIZE`, max 100.

- [ ] **Step 1: Failing e2e** (`describe('api')`): newest first with `nextCursor` paging; each filter narrows (`ruleset`, `ref` with and without prefix, `actor`, `result`, `enforcement`, `period=hour` excludes a suite whose `createdAt` is moved back 2h via a DB update, `period=all` includes it); non-admin collaborator (write) gets 404 (or the repo's existing admin-refusal status — assert what `rulesets` `POST` returns for a writer); renamed ruleset keeps old name on old suites; deleted ruleset reads `deleted ruleset`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**, then `bun run openapi`. **Step 4: Run** → PASS. Checkpoint.

### Task 5: GitHub REST `rule-suites`

**Files:**
- Modify: `apps/api/src/github/rest/rulesets/rulesets.controller.ts` (two routes declared **before** `rulesets/:id`)
- Modify: `apps/api/src/github/rest/rulesets/rulesets.service.ts` (`ruleSuites`, `ruleSuite`)
- Test: `apps/api/test/github-rule-suites.e2e-spec.ts` (new; harness as `github-rulesets.e2e-spec.ts`)

**Interfaces:**
- Consumes: `ruleSuiteFilter`, `RuleSuitesService.get`.
- `GithubRulesetsService.ruleSuites(target: GithubRepositoryTarget, query: Record<string, unknown>): Promise<RestPage<object>>` — `github.readable`, then admin via the Ghost service's authorize; `pageOf(query)`; `time_period` (`hour|day|week|month`, default `day`), `actor_name`, `ref`, `rule_suite_result` (`all` default), `evaluate_status` (`all|active|evaluate`); unknown enum values → GitHub's 422 (`UnprocessableError`).
- `GithubRulesetsService.ruleSuite(target, numericId: number, includeMetadata: boolean)`.
- Response fields exactly as the spec's API section: `id` (numericId), `actor_id` and `actor_name` (same user id mapping `toUserRest` uses), `before_sha`, `after_sha`, `ref`, `repository_id`, `repository_name`, `pushed_at`, `result`, `evaluation_result`; detail adds `rule_evaluations[{ rule_source: { type: 'ruleset', id: <ruleset numericId or null>, name }, enforcement, result, rule_type, details }]`, and with `include_metadata=true` a merge's `metadata.pull_request { id, number, user, reviews }` (max 50 reviews).

- [ ] **Step 1: Failing e2e**: list shape and `Link` header paging (`per_page=1`); each query filter; detail shape; `include_metadata` on a merge suite; non-admin 404; `GET rulesets/rule-suites` is not routed to `rulesets/:id` (status 200, array); unknown `rule_suite_id` 404; bad `time_period` 422.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS, plus `github-rulesets.e2e-spec.ts`. Checkpoint.

### Task 6: Web Insights tab

**Files:**
- Create: `apps/web/src/components/rulesets/rules-tabs.tsx` (Rulesets | Insights link tabs; first check `components/` for an existing link-tabs component and reuse it — rule 9)
- Modify: `apps/web/src/app/[username]/[repo]/settings/rules/page.tsx` (render tabs)
- Create: `apps/web/src/app/[username]/[repo]/settings/rules/insights/page.tsx`, `loading.tsx`, `rule-suite-filters.tsx`, `rule-suite-timeline.tsx` (timeline + its skeleton in the same file)

**Interfaces:**
- Consumes: `GET /api/repositories/{username}/{repo}/rule-suites` and `GET .../rulesets` (for the ruleset filter), via `createServerClient`.
- Filters live in the URL (`ruleset`, `ref`, `actor`, `result`, `enforcement`, `period`, `cursor`); `CursorPagination` for paging; page `notFound()` when the API refuses.

- [ ] **Step 1: Build** per spec "Insights view": day groups (Today / Yesterday / date, viewer's local time), row = result icon, actor, "pushed to `ref`" / "merged #N into `ref`", short SHAs, badge Passed/Failed/Bypassed, "evaluate: would fail" badge when `result === 'pass' && evaluationResult === 'fail'`, relative time; click expands rules grouped by ruleset with enforcement badge (`evaluate`, `deleted`) and ✓/✗ + details. Period options: Last hour / Last 24 hours / Last week / Last month / All time.
- [ ] **Step 2: Verify** `bun run --filter @ghost/web check-types` (or the web package's type check script) and lint pass; then run the app and check the page by hand against a throwaway DB with a passing, failing, bypassed and evaluate suite. Checkpoint.

### Task 7: Whole-branch verification

- [ ] Full API e2e on throwaway containers (`--no-file-parallelism`); compare failures with the known list in memory (storage-limits fork quota, release draft webhook).
- [ ] `bunx biome check` on changed files: no new findings versus `main`.
- [ ] Re-read the spec's Goals and Anti-goals and tick each against a test.
