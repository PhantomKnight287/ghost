# Rulesets B: pull request rule and merge blocking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub's `pull_request` ruleset rule with all six parameters, review thread resolution, merge blocking with an explicit bypass, and truthful gh compat fields.

**Architecture:** The pure evaluator (`lib/rulesets/evaluate-rulesets.ts`) gains the `pull_request` rule. It takes precomputed `PullRequestFacts` and returns violations and bypassed violations separately. One service, `PullRequestRulesService`, computes those facts from the database and git. Merging, the merge box, `reviewDecision`, `mergeStateStatus` and REST `mergeable_state` all read from it. Stale approvals are judged at merge time from `pull_request_review.commit_sha` and the new `base_sha`. An outbox consumer only writes the visible dismissals.

**Tech Stack:** NestJS, Drizzle (Postgres), vitest, GraphQL code-first (`@nestjs/graphql`), Next.js web app, git CLI.

**Spec:** `docs/superpowers/specs/2026-10-21-rulesets-b-design.md` (read it with this plan; part A: `docs/superpowers/specs/2026-10-19-rulesets-a-design.md`).

## Global Constraints

- **Copy GitHub.** Where the spec is silent, do what GitHub does. Items marked "verify" are checked in Task 9.
- **Workflow per task.** Claude writes the failing tests. The user writes the backend code to make them pass. Claude then audits: confirms the tests are really green, and checks that no test was weakened or skipped and that no test input is special-cased. Claude writes all frontend code (Task 8).
- **No commits** unless the user asks. Work on branch `feat/rulesets-b`.
- **Migrations:** run `bun db:generate` at the repository root. Never hand-edit drizzle SQL.
- **Database:** run e2e only against throwaway Postgres and RustFS, never the dev database at 192.168.1.4. Recipe:
  1. Start Postgres `postgres:16-alpine` on port 55433.
  2. Start `rustfs/rustfs:latest` on port 59000.
  3. Run: `TEST_DATABASE_URL=... TEST_S3_ENDPOINT=http://localhost:59000 npx vitest run --config ./vitest.config.e2e.ts --no-file-parallelism <file>` from `apps/api`.
- **Unit tests:** `npx vitest run <file>` from `apps/api`.
- **Message pinned by tests:** `Changes must be made through a pull request.` exactly. Tests identify every other message by its `requirement`, not its text. Take that text from GitHub.
- **Bypass checkbox label:** `Merge anyway, bypassing ruleset requirements`.
- **Cost:** a repository with no active `pull_request` rule runs no extra git command, and adds no query beyond part A's one, when a pull request is viewed or merged.
- **Code style:** match the surrounding code's comment density, naming and idiom.

## Review Focus

These cases are likely to hurt real users and no task covers them yet. Each has a test in the task named after it.

1. **A reviewer loses write access after approving.** Their approval stops counting. Owner: Task 5, `drops an approval whose reviewer lost write access`.
2. **A reviewer requests changes, then approves.** Their latest verdict is the approval, so the change request no longer blocks. A dismissed change request also stops blocking. Owner: Task 5, `latest verdict wins`.
3. **The allowed merge methods have nothing in common.** For example, one ruleset allows only `merge` and another has `required_linear_history`. No method can be used, and the merge box lists none. A bypass can still merge with any method the repository allows. Owner: Task 1, `empty method intersection blocks every method`.
4. **A ruleset is disabled or edited while a pull request is open.** The merge box and the merge use the current rulesets, and nothing is cached across requests. Owner: Task 6, `disabling the ruleset unblocks immediately`.
5. **The PR author pushed last and someone else approved.** That approval satisfies `require_last_push_approval`. An approval by a reviewer who pushed a commit to the PR afterwards does not satisfy it. Owner: Task 1, `last push approval`.

---

## File Structure

**Backend (the user implements; Claude writes the tests):**
- `apps/api/src/lib/rulesets/rulesets.types.ts`: add `'pull_request'` to `RuleType`, plus `PullRequestRuleParameters`, `PullRequestFacts`, `Requirement` and `RulesetEvaluation`. `RulesetVerdict` gains `bypassed`.
- `apps/api/src/lib/rulesets/evaluate-rulesets.ts`: the pull request checks, the `bypassed` split and `allowedMergeMethods`.
- `apps/api/src/lib/rulesets/pull-request-parameters.ts` (new): validates and defaults the parameters.
- `packages/db/src/schema/pull-requests.ts`, `packages/db/src/schema/issues.ts`: the new columns and the `rules_bypassed` timeline event.
- `apps/api/src/services/rulesets/pull-request-rules.service.ts` (new): the facts and the merge requirements.
- `apps/api/src/services/rulesets/stale-approvals.service.ts` (new): the outbox consumer.
- `apps/api/src/services/rulesets/ruleset-verdicts.service.ts`: `judge` passes the facts through and returns `bypassed`.
- `apps/api/src/resources/pull-requests/review-threads.service.ts` (new), with endpoints in `reviews.controller.ts`.
- `apps/api/src/resources/pull-requests/pull-requests.service.ts`, `pull-requests.controller.ts`: blocking, the bypass flag and the merge requirements endpoint.
- `apps/api/src/services/pull-requests/pull-request-pushes.service.ts`: sets `headPushedById`.
- `apps/api/src/git/git.service.ts`: the bypass sideband notice.
- `apps/api/src/github/graphql/...`: `reviewThreads` and its mutations, `reviewDecision`, `mergeStateStatus`, `repository.rulesets`, `Ref.branchProtectionRule`.
- `apps/api/src/lib/github/rest.ts`, `apps/api/src/github/rest/pulls/pulls.service.ts`: `mergeable_state` and the 405.

**Tests (Claude writes them):**
- `apps/api/src/lib/rulesets/evaluate-rulesets.spec.ts` (extend; part A's cases move to `.violations`)
- `apps/api/src/lib/rulesets/pull-request-parameters.spec.ts` (new)
- `apps/api/test/rulesets.e2e-spec.ts`, `apps/api/test/github-rulesets.e2e-spec.ts` (extend)
- `apps/api/test/review-threads.e2e-spec.ts` (new)
- `apps/api/test/pull-request-rules.e2e-spec.ts` (new)
- `apps/api/test/rulesets-enforcement.e2e-spec.ts` (extend)
- `apps/api/test/github-pulls.e2e-spec.ts`, `apps/api/test/github-graphql.e2e-spec.ts`, `apps/api/test/gh-cli.e2e-spec.ts` (extend)

**Frontend (Claude writes it):**
- `apps/web/src/components/rulesets/ruleset-form.tsx`
- `apps/web/src/app/[username]/[repo]/pull/[number]/merge-panel.tsx`, `merge-button.tsx`
- the review thread components under `apps/web/src/app/[username]/[repo]/pull/[number]/files/` and the conversation timeline

---

### Task 1: Evaluator — the `pull_request` rule and the bypassed split

**Files:**
- Modify: `apps/api/src/lib/rulesets/rulesets.types.ts`
- Modify: `apps/api/src/lib/rulesets/evaluate-rulesets.ts`
- Test: `apps/api/src/lib/rulesets/evaluate-rulesets.spec.ts`

**Interfaces:**
- Consumes: part A's `evaluateRulesets`, `bypassOf` and `refTargeted`.
- Produces:

```ts
export type MergeMethod = 'merge' | 'squash' | 'rebase';
export type RuleType = /* A's five */ | 'pull_request';
export type PullRequestRuleParameters = {
  required_approving_review_count: number;
  dismiss_stale_reviews_on_push: boolean;
  require_code_owner_review: boolean;
  require_last_push_approval: boolean;
  required_review_thread_resolution: boolean;
  allowed_merge_methods: MergeMethod[];
};
/** Which part of `pull_request` a violation is about; absent for the other rules. */
export type Requirement =
  | 'pull_request'        // a direct push
  | 'approvals'
  | 'changes_requested'
  | 'code_owners'
  | 'last_push'
  | 'threads'
  | 'merge_method';
export type PullRequestFacts = {
  authorId: string;
  method: MergeMethod;
  /** Each reviewer's latest submitted, non-dismissed approval, reviewer has write access now, author excluded. */
  approvals: { userId: string; teamIds: string[]; stale: boolean }[];
  /** Reviewers with write access whose latest verdict is changes_requested. */
  changesRequestedBy: string[];
  headPushedById: string | null;
  /** Changed paths that have resolvable code owners, one entry per matching CODEOWNERS rule. */
  codeOwners: { pattern: string; userIds: string[]; teamIds: string[]; tokens: string[] }[];
  unresolvedThreads: number;
};
export type Violation = { ref; rulesetId; rulesetName; rule: RuleType; requirement?: Requirement; message: string };
export type RulesetEvaluation = { violations: Violation[]; bypassed: Violation[] };
export type RulesetVerdict = { transitions: RefTransition[]; violations: Violation[]; bypassed: Violation[] };

export function evaluateRulesets(payload: {
  rulesets; actor; write; transitions; facts; defaultBranch;
  pullRequest?: PullRequestFacts;
}): RulesetEvaluation;
/** The merge methods every applicable ruleset allows, after `required_linear_history` removes `merge`. */
export function allowedMergeMethods(rulesets: Ruleset[], ref: string, defaultBranch: string): MergeMethod[];
```

`rules[].parameters` for `pull_request` is typed `PullRequestRuleParameters`. The evaluator reads parameters that are already validated (Task 2).

- [x] **Step 1: Move part A's cases to the new return shape**

Change the `evaluate` helper in `evaluate-rulesets.spec.ts` to return `evaluateRulesets(...).violations`. Add `evaluateAll` to return both lists. Leave every existing assertion as it is. Change the bypass cases, which asserted `[]`, to also assert that `bypassed` holds the violation the actor skipped:

```ts
it('a bypassed ruleset lands in bypassed, not violations', () => {
  const r = evaluateAll({ rulesets: [ruleset(['update'], { bypassActors: [{ actorType: 'RepositoryRole', role: 'write', bypassMode: 'always' }] })], transitions: [update()] });
  expect(r.violations).toEqual([]);
  expect(r.bypassed).toMatchObject([{ rule: 'update' }]);
});
```

- [x] **Step 2: Write the failing `pull_request` cases**

Add a `describe('pull_request')` block. It has `prRuleset(params: Partial<PullRequestRuleParameters>)` with defaults of zero approvals and all flags off, and `facts(overrides)` with defaults of author `u_author`, method `squash` and nothing else. Tests and their key assertions:

- `refuses a direct push update with "Changes must be made through a pull request."`: `write: 'push'`, `update()` gives `[{ rule: 'pull_request', requirement: 'pull_request', message: 'Changes must be made through a pull request.' }]`.
- `does not refuse create or delete on push`: `create()` and `remove()` give `[]`. Verified against GitHub in Task 9.
- `merge without pull request facts fails closed`: `write: 'pull_request_merge'`, no `pullRequest`, gives a violation with `rule: 'pull_request'`.
- `approvals`: count 2 with one approval gives `requirement: 'approvals'`. With two approvals it passes.
- `stale approvals count only when dismiss_stale is off`: one approval with `stale: true` passes with `dismiss_stale_reviews_on_push: false` and gives `approvals` with `true`.
- `changes requested blocks even with enough approvals`: `changesRequestedBy: ['u_r']` and count 0 give `requirement: 'changes_requested'`. With count 0 and all flags off, this still blocks only when `required_approving_review_count >= 1` or `require_code_owner_review`. Verify against GitHub in Task 9. Pin the case of count ≥ 1 here.
- `code owners by user`: entry `{ userIds: ['u_owner'] }`. An approval by `u_owner` passes. An approval by `u_other` gives `requirement: 'code_owners'`, and the `message` contains each waiting token.
- `code owners by team`: entry `{ teamIds: ['t1'] }`. An approval with `teamIds: ['t1']` passes.
- `sole code owner author is blocked`: the author is `u_owner` and has no approvals, which gives `code_owners`.
- `stale code owner approval does not satisfy with dismiss_stale on`.
- `last push approval`: `headPushedById: 'u_pusher'`. A fresh approval by `u_r` passes. A fresh approval only by `u_pusher` gives `requirement: 'last_push'`. A stale approval by `u_r` gives `last_push`. `headPushedById: null` gives `last_push`.
- `threads`: `unresolvedThreads: 1` with the flag on gives `requirement: 'threads'`. With the flag off it passes.
- `merge method`: `allowed_merge_methods: ['squash']` with `method: 'merge'` gives `requirement: 'merge_method'`.
- `reports every unmet requirement at once`: count 1, code owners, threads and the method all unmet give four violations, each with its own `requirement`.
- `several rulesets add up`: count 1 and count 2 with one approval give `approvals` from the count-2 ruleset only. Booleans OR together.
- `pull_request bypass mode on merge goes to bypassed, still refused on push`.
- `allowedMergeMethods`: the intersection across targeted rulesets. `required_linear_history` drops `merge`. A ref that no ruleset targets gives all three.
- `empty method intersection blocks every method` (Review Focus 3): `['merge']` in one ruleset and `required_linear_history` in another give `[]`, and every method gives a `merge_method` violation.

- [x] **Step 3: Run the tests and confirm they fail**

Run: `npx vitest run src/lib/rulesets/evaluate-rulesets.spec.ts`
Expected: FAIL. The new tests fail on type errors or missing behaviour, and part A's cases fail only because of the return shape until the user changes it.

- [x] **Step 4: The user implements the types and the evaluator**

How rulesets add up: each ruleset reports its own violations, so the violation names the ruleset that caused it. Approvals are compared per ruleset with that ruleset's count. Merge method is checked against each ruleset's own list, plus `required_linear_history`, which part A already handles as `introducesMergeCommit`.

- [x] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run src/lib/rulesets/`
Expected: PASS, including `ref-pattern.spec.ts`.

- [x] **Step 6: Claude audits** the evaluator diff and the test diff.

---

### Task 2: `pull_request` parameters through the Ghost API and REST

**Files:**
- Create: `apps/api/src/lib/rulesets/pull-request-parameters.ts`
- Modify: `apps/api/src/resources/rulesets/dto/ruleset.dto.ts`, `apps/api/src/resources/rulesets/rulesets.service.ts`, `apps/api/src/github/rest/rulesets/rulesets.service.ts`
- Test: `apps/api/src/lib/rulesets/pull-request-parameters.spec.ts`, `apps/api/test/rulesets.e2e-spec.ts`, `apps/api/test/github-rulesets.e2e-spec.ts`

**Interfaces:**
- Consumes: `PullRequestRuleParameters` (Task 1).
- Produces:

```ts
/** Defaults filled in GitHub's way; returns an error message for an invalid body. */
export function parsePullRequestParameters(input: unknown): { ok: true; value: PullRequestRuleParameters } | { ok: false; message: string };
```

- [x] **Step 1: Write the failing unit tests**

- defaults for omitted fields match GitHub's REST schema. Fill in the values from GitHub's docs while writing the test: `allowed_merge_methods` defaults to all three, and the booleans default to false.
- `required_approving_review_count` outside 0 to 10, or not an integer, fails.
- an empty `allowed_merge_methods`, an unknown method, or a duplicate method fails.
- unknown keys fail.

- [x] **Step 2: Write the failing e2e tests**

`rulesets.e2e-spec.ts`:
- `POST` with `{ type: 'pull_request', parameters: {...} }` gives 201 and round-trips the parameters;
- a bad count gives 400;
- `PUT` replaces the parameters.

`github-rulesets.e2e-spec.ts`:
- `POST /repos/{o}/{r}/rulesets` with GitHub's documented `pull_request` example body gives 201 and the parameters field by field;
- an invalid body gives 422 with `message`;
- `GET /rules/branches/main` includes `{ type: 'pull_request', parameters, ruleset_source_type: 'Repository' }`.

- [x] **Step 3: Run the tests and confirm they fail**

Run: the unit test plus the two e2e files.
Expected: FAIL.

- [x] **Step 4: The user implements** parameter validation at both boundaries, stored in `ruleset_rule.parameters`.

- [x] **Step 5: Run the tests and confirm they pass**

- [x] **Step 6: Claude audits**

---

### Task 3: Data

**Files:**
- Modify: `packages/db/src/schema/pull-requests.ts`, `packages/db/src/schema/issues.ts`
- Generate: a migration with `bun db:generate`.

**Interfaces:**
- Produces these columns:
  - `pull_request.head_pushed_by_id`: text, nullable, references `user.id`, `on delete set null`.
  - `pull_request_review.base_sha`: text, nullable. Null for reviews submitted before the migration.
  - `pull_request_review_comment.resolved_by_id`: text, nullable, references `user.id`, `on delete set null`.
  - `pull_request_review_comment.resolved_at`: timestamptz, nullable.

  The two resolution columns are used only on root comments. The thread table option in the spec is declined: columns are the smaller diff.
- Produces `issue_event_type` value `rules_bypassed`. Its details (ruleset ids and names, rules, requirements) follow however `issueEvent` stores extra data today. If it has no payload column, add a nullable jsonb `details`.
- Each new column gets a schema doc comment in the file's style.

- [x] **Step 1: The user edits the schema and runs `bun db:generate`**
- [x] **Step 2: Apply the migration to a throwaway database.** The existing suites must still pass: run `npx vitest run --config ./vitest.config.e2e.ts --no-file-parallelism test/pull-request-reviews.e2e-spec.ts test/rulesets.e2e-spec.ts`. Expected: PASS.
- [x] **Step 3: Claude audits** the generated SQL. No data rewrite, nullable columns only.

---

### Task 4: Review thread resolution

**Files:**
- Create: `apps/api/src/resources/pull-requests/review-threads.service.ts`
- Modify: `apps/api/src/resources/pull-requests/reviews.controller.ts`, the review comment DTOs, `apps/api/src/lib/events/events.ts`, `apps/api/src/github/graphql/types/pull-request.type.ts`, the pull-request resolvers and pull-request-mutations
- Test: `apps/api/test/review-threads.e2e-spec.ts`, `apps/api/test/github-graphql.e2e-spec.ts`

**Interfaces:**
- Ghost API, under `/api/repositories/:username/:repo/pulls/:number`:
  - `POST comments/:commentId/resolve` gives 200 with the thread state;
  - `POST comments/:commentId/unresolve` gives 200;
  - `:commentId` must be a root comment, otherwise 422;
  - 403 for anyone other than the PR author or someone with write access;
  - 404 for a comment on another pull request.
- Every review comment DTO for a root comment gains `resolved: boolean` and `resolvedBy: { username } | null`.
- Events: `'pull_request_review_thread.resolved': { issueId: string; commentId: string }` and `.unresolved`, with the same shape.
- GraphQL:
  - `PullRequest.reviewThreads(first, last, after)` returns a connection of `PullRequestReviewThread`. Its fields are `id` (node id), `isResolved`, `isOutdated`, `isCollapsed` (equals `isResolved`), `resolvedBy`, `viewerCanResolve`, `viewerCanUnresolve`, `path`, `line`, `startLine`, `diffSide` and `comments`.
  - Mutations `resolveReviewThread(input: { threadId })` and `unresolveReviewThread`, which return `{ thread }`.
- `ReviewThreadsService`:
  - `resolve(params: PullRequestRef & { requesterId: string; commentId: string; resolved: boolean })`;
  - `unresolvedCount(pullRequestId: string): Promise<number>`, used by Task 5.

- [x] **Step 1: Write the failing e2e tests** in `review-threads.e2e-spec.ts`:
  - the author resolves and unresolves;
  - a write collaborator resolves;
  - a read-only commenter who wrote the thread gets 403;
  - a reply id gets 422;
  - resolving twice is idempotent and emits one event;
  - each change writes the outbox event;
  - the DTO shows `resolved`.
- [x] **Step 2: Write the failing GraphQL tests** in `github-graphql.e2e-spec.ts`:
  - `reviewThreads` lists a thread with `isResolved: false`;
  - `resolveReviewThread` flips it, and `resolvedBy.login` equals the viewer;
  - `viewerCanResolve` is false for a reader;
  - unresolve works.
- [x] **Step 3: Run the tests and confirm they fail**
- [x] **Step 4: The user implements** the service, the endpoints, the events and GraphQL.
- [x] **Step 5: Run the tests and confirm they pass**
- [x] **Step 6: Claude audits**

---

### Task 5: Facts — `PullRequestRulesService`, pusher, base sha, stale consumer

**Files:**
- Create: `apps/api/src/services/rulesets/pull-request-rules.service.ts`, `apps/api/src/services/rulesets/stale-approvals.service.ts`
- Modify: `apps/api/src/services/pull-requests/pull-request-pushes.service.ts` (set `headPushedById` from `pushedBy`), `apps/api/src/resources/pull-requests/reviews.service.ts` `submitReview` (record `baseSha` as the base tip), `apps/api/src/services/events/outbox.service.ts` (register the consumer)
- Test: `apps/api/test/pull-request-rules.e2e-spec.ts`

**Interfaces:**
- Consumes: `CodeownersService.load`, `matchingRule`, `listDiffFiles`, `ReviewThreadsService.unresolvedCount` and `RulesetVerdictsService.active` / `actorOf`.
- Produces:

```ts
@Injectable()
export class PullRequestRulesService {
  /** Rulesets with a pull_request rule targeting the base; [] costs one query and nothing else. */
  applicable(repository: { id: string; defaultBranch: string | null }, gitDir: string, baseRef: string): Promise<Ruleset[]>;
  /** Only the git work the applicable parameters need: CODEOWNERS and changed files only with require_code_owner_review, diff identity only with dismiss_stale or last_push. */
  factsOf(opened: Opened /* from pull-requests.service openLive */, rulesets: Ruleset[], method: MergeMethod): Promise<PullRequestFacts>;
  /** What the merge box shows the viewer. */
  requirements(params: PullRequestRef & { viewerId: string | null; method?: MergeMethod }): Promise<MergeRequirements>;
}
export type MergeRequirements = {
  violations: Violation[];
  bypassed: Violation[];
  /** Methods the rulesets allow; the merge box offers only these. */
  allowedMethods: MergeMethod[];
};
```

Staleness of an approval on commit `X` with `baseSha` `B`. It is stale when either holds:
- `B` is non-null and differs from the current base tip;
- the diff from `X`'s merge base to `X` differs from the diff from the current merge base to the head. Compare with `git patch-id --stable` of each diff. A commit that is missing counts as stale.

Mark the per-request git work with `// ponytail: per-request git work for list queries; persist facts keyed by (head, base) if gh pr list gets slow`.

`StaleApprovalsService.handle(event)`:
- on `pull_request.synchronized`, and on `push` to a ref that is the base of open pull requests, dismiss every stale approval;
- it does this only on rulesets whose `dismiss_stale_reviews_on_push` is on;
- each dismissal sets `dismissalMessage` and leaves `dismissedById` null, and emits `pull_request.review_dismissed`.

The message text comes from GitHub, recorded in Task 9.

- [x] **Step 1: Write the failing e2e tests** in `pull-request-rules.e2e-spec.ts`. Set up through the Ghost API and git push, as in `rulesets-enforcement.e2e-spec.ts`, and call `requirements` through the endpoint from Task 6, or directly with `app.get(PullRequestRulesService)`. Tests:
  - `no pull_request rule: no requirements`;
  - `counts an approval from a write collaborator, not the author`;
  - `drops an approval whose reviewer lost write access` (Review Focus 1);
  - `latest verdict wins` (Review Focus 2): changes requested then approve unblocks, and a dismissed change request unblocks;
  - `new head commit makes approval stale`;
  - `conflict-free rebase keeps approval`;
  - `base move makes approval stale`: another PR merges into main;
  - `pre-migration review (null base_sha) is not stale from the base side`;
  - `code owner from base CODEOWNERS, not head`: the head edits CODEOWNERS to drop the owner, and the requirement stays;
  - `team code owner satisfied by a team member's approval`;
  - `headPushedById follows git push and suggestion apply`;
  - `unresolved thread counts; resolving clears it`;
  - `stale consumer dismisses with null dismissedById and emits review_dismissed`;
  - `stale consumer does nothing when dismiss_stale is off`.
- [x] **Step 2: Run the tests and confirm they fail**
- [x] **Step 3: The user implements**
- [x] **Step 4: Run the tests and confirm they pass**, along with `codeowner-requests.e2e-spec.ts` and `pull-request-reviews.e2e-spec.ts`.
- [x] **Step 5: Claude audits.** Check by hand that a repository with no rulesets runs no git command in `requirements`.

---

### Task 6: Enforcement — push refusal, the bypass notice, merge blocking, the bypass flag

**Files:**
- Modify: `apps/api/src/services/rulesets/ruleset-verdicts.service.ts` (`judge` accepts `pullRequest?: PullRequestFacts` and returns `bypassed`), `apps/api/src/git/git.service.ts` (the notice), `apps/api/src/resources/pull-requests/pull-requests.service.ts` `mergePullRequest`, `pull-requests.controller.ts`, `dto/pull-request-changes.dto.ts`
- Test: `apps/api/test/rulesets-enforcement.e2e-spec.ts`, `apps/api/test/pull-request-rules.e2e-spec.ts`

**Interfaces:**
- `MergePullRequestRequestDTO.bypassRules?: boolean`.
- `mergePullRequest(params & { bypassRules?: boolean; compat?: boolean })`:
  - `compat: true` comes from the REST and GraphQL compat callers, and allows bypassed violations without the flag.
  - Ghost's API without the flag throws a new `RulesetBypassRequiredError`: 422, carrying `bypassed`, with a message saying that a bypass is available.
- After a merge with a non-empty `bypassed`, write an `issueEvent` of type `rules_bypassed` and its outbox event, in the merge transaction.
- `GET /api/repositories/:username/:repo/pulls/:number/merge-requirements?method=` returns `MergeRequirements` for the signed-in viewer.
- Push: when `verdict.bypassed` is non-empty and `violations` is empty, the sideband prints `Bypassed rule violations for <ref>:` followed by `- <message>` for each one. Correct the exact text from GitHub in Task 9.

- [x] **Step 1: Write the failing push tests** in `rulesets-enforcement.e2e-spec.ts`:
  - `pull_request rule refuses a direct push to main with GH013 and "Changes must be made through a pull request."`;
  - `an always-bypass push lands and prints the bypassed notice`;
  - `a pull_request-mode bypasser's direct push is still refused`.
- [x] **Step 2: Write the failing merge tests** in `pull-request-rules.e2e-spec.ts`:
  - `merge refused with 422 listing every unmet requirement`: approvals, code owners and threads give three entries, each naming the ruleset;
  - `merge allowed once requirements met`;
  - `bypasser without flag gets 422 bypass-required; with bypassRules merges and writes rules_bypassed timeline event and outbox event`;
  - `part A update rule bypassed on merge also needs the flag`;
  - `non-bypasser with bypassRules still refused`;
  - `merge-requirements endpoint lists violations, bypassed and allowedMethods`;
  - `disabling the ruleset unblocks immediately` (Review Focus 4);
  - `merge judges the head it loaded`: a push to the head after the requirements were met, with `dismiss_stale` on, leads to a refused merge.
- [x] **Step 3: Run the tests and confirm they fail**
- [x] **Step 4: The user implements**
- [x] **Step 5: Run the tests and confirm they pass**, along with `rulesets-enforcement.e2e-spec.ts` in full and `merge-methods.e2e-spec.ts`.
- [x] **Step 6: Claude audits**

---

### Task 7: gh compatibility

**Files:**
- Modify: `apps/api/src/github/graphql/resolvers/pull-request/pull-request-nodes.service.ts` (`reviewDecision`, `mergeStateStatus`), `apps/api/src/lib/github/rest.ts` (`mergeable_state`), `apps/api/src/github/rest/pulls/pulls.service.ts` (the 405), `pull-request-mutations.service.ts` (the GraphQL error), `apps/api/src/github/graphql/types/repository.type.ts` and its resolver (`rulesets`), `lib/github/nodes.ts` (`branchProtectionRule`)
- Test: `apps/api/test/github-pulls.e2e-spec.ts`, `apps/api/test/github-graphql.e2e-spec.ts`, `apps/api/test/gh-cli.e2e-spec.ts`

**Interfaces:**
- Consumes: `PullRequestRulesService.requirements` (Task 5), memoised per GraphQL request through `Loaders`.
- `reviewDecision`:
  - `CHANGES_REQUESTED` when there is a `changes_requested` violation;
  - otherwise `REVIEW_REQUIRED` for `approvals` or `code_owners`;
  - otherwise `APPROVED` when an applicable rule requires reviews;
  - with no applicable rule, GitHub's answer, recorded in Task 9. The expected answer is `null`.
- `mergeStateStatus`:
  - `DRAFT` and `DIRTY` keep their precedence;
  - otherwise `BLOCKED` when `violations` or `bypassed` is non-empty;
  - otherwise the current result.
- REST: `mergeable_state: 'blocked'` in the same case. `PUT /pulls/{n}/merge` answers 405 `{ message }` listing every violation, for a non-bypasser.
- `repository.rulesets(first, after)`: a `RepositoryRuleset` with `databaseId`, `name`, `target`, `enforcement`, `conditions { refName { include exclude } }`, `rules { nodes { type parameters } }` and `bypassActors`. The bypass actors are for admins only.

- [x] **Step 1: Write the failing tests:**
  - REST `mergeable_state` is `blocked`, and `clean` once met;
  - 405 on PUT merge with the message listing the requirements;
  - an admin bypass actor's PUT merge succeeds without a flag;
  - GraphQL `reviewDecision` gives `REVIEW_REQUIRED`, `CHANGES_REQUESTED` or `APPROVED`;
  - `mergeStateStatus` is `BLOCKED`, including for a bypass actor;
  - `mergePullRequest` errors with the list;
  - `repository.rulesets` matches the REST ruleset;
  - in `gh-cli.e2e-spec.ts`, `gh pr merge` on a blocked PR exits non-zero with gh's base branch policy text, and `gh pr view --json reviewDecision,mergeStateStatus` shows `REVIEW_REQUIRED`/`BLOCKED`.

  Leave `Ref.branchProtectionRule` and the no-rule `reviewDecision` assertions for after Task 9 records GitHub's answer.
- [x] **Step 2: Run the tests and confirm they fail**
- [x] **Step 3: The user implements**
- [x] **Step 4: Run the tests and confirm they pass**, including `github-graphql.e2e-spec.ts` and `github-pulls.e2e-spec.ts` in full. Use the gh suite recipe from memory for `gh-cli.e2e-spec.ts`.
- [x] **Step 5: Claude audits**

---

### Task 8: Web (Claude)

**Files:**
- Modify: `apps/web/src/components/rulesets/ruleset-form.tsx`, `apps/web/src/app/[username]/[repo]/pull/[number]/merge-panel.tsx`, `merge-button.tsx`, `page.tsx` (fetch `merge-requirements`), the review thread components in `pull/[number]/files/` and the conversation timeline, and the timeline event renderer (`rules_bypassed`, system dismissal)
- Regenerate the web API types (`apps/web/src/lib/api/v1`) the way the repository already does.

Behaviour:
- **Ruleset form:** a "Require a pull request before merging" rule, with GitHub's labels and descriptions for:
  - the approval count (0 to 10);
  - four checkboxes;
  - the merge method checkboxes, at least one.
- **Merge panel:**
  - one row per violation and per bypassed violation, with a reason and the ruleset name;
  - the merge button is disabled while `violations` is non-empty;
  - the method menu lists only `allowedMethods`;
  - when only `bypassed` is non-empty, a checkbox labelled `Merge anyway, bypassing ruleset requirements`. The button enables once it is ticked and sends `bypassRules: true`.
- **Threads:** Resolve and Unresolve buttons, shown when the viewer can use them. Resolved threads are collapsed, with a "Show resolved" toggle.
- **Timeline:** "bypassed rules", and "approval dismissed as stale".

- [ ] **Step 1:** Build it, run the web typecheck and lint, then check by hand in the running app with a ruleset on `main`. Use the `run` skill.

---

### Task 9: Verify against GitHub and close out

- [ ] **Step 1:** On a scratch repository on the GitHub remote, set up a ruleset with every `pull_request` parameter. Record:
  - every merge box and API message;
  - the bypass push notice;
  - whether `pull_request` refuses creation or deletion;
  - `reviewDecision` with no rule;
  - `mergeStateStatus` for a bypass actor;
  - `Ref.branchProtectionRule` for a ruleset-only branch;
  - whether API bypass merges need nothing extra;
  - how a CODEOWNERS file with errors is applied;
  - whether a base move dismisses only when the files overlap;
  - whether a change request blocks with a count of 0;
  - the stale dismissal message.
- [x] **Step 2:** Put the recorded wording in the evaluator and the notice. Add the deferred Task 7 assertions. Update the spec wherever GitHub differed.
- [x] **Step 3:** Run the full API suite, unit and e2e, against throwaway Postgres and RustFS. Expected: green except the known failures noted in memory (`storage-limits` fork quota, `webhook-events` release).
- [x] **Step 4:** Check the cost anti-goal by hand: view and merge a PR in a repository without rulesets, with git command tracing on, and see no extra git command and at most one ruleset query.
