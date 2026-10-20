# Repository rulesets, part A: rulesets and ref rules

Issue: #87 on Ghost, #140 on GitHub (parent: #17 on Ghost, #62 on GitHub). This is the first of four pull requests:

- **A (this document):** the ruleset model, its API and settings page, and enforcement of the ref rules.
- **B (#88 / #141):** the `pull_request` rule (including code owner review), merge blocking, and the gh compat fields (`Ref.branchProtectionRule`, `reviewDecision`, `mergeStateStatus`, REST `mergeable_state`, 405 on a blocked merge).
- **C (#89 / #142):** `required_status_checks`.
- **D (#90 / #143):** `required_signatures`.

## Intent

Ghost has no way to protect a branch or tag. Anyone with write access can force-push `main`, delete it, or move a release tag. This work adds GitHub's repository rulesets and the rules that act on the ref itself.

Copy GitHub as closely as possible. It is the industry standard, its documentation doubles as ours, and people moving from GitHub should find the same behaviour. Where this document is silent, do what GitHub does.

## Goals

1. Repository admins can create, edit, disable and delete rulesets that target branches or tags.
2. A ruleset selects refs by name patterns, with `~DEFAULT_BRANCH` and `~ALL`.
3. Five rules are enforced on every user write to a targeted ref: `creation`, `update`, `deletion`, `non_fast_forward`, `required_linear_history`.
4. Bypass actors can skip a ruleset, either always or only through pull requests.
5. A rejected push tells the user which ruleset and which rule refused it, in GitHub's wording.
6. The REST API matches GitHub's for repository rulesets, so existing scripts and `gh api` calls work.
7. No write path can skip enforcement by accident.

## Non-goals

- Organization rulesets. Repository level only. The schema must not assume a ruleset belongs to a repository forever; see Data.
- Push rulesets (file path, file size, file extension rules).
- `evaluate` enforcement (GitHub Enterprise only).
- Rule insights (the history of evaluations).
- Integration and deploy key bypass actors, until Ghost has those actors.
- GraphQL `repository.rulesets`. Comes with B alongside the other GraphQL fields, unless it falls out cheaply here.
- Classic branch protection rules and their API (`/branches/{branch}/protection`). Ghost only has rulesets.

## Anti-goals

- Any REST shape that differs from GitHub's where GitHub defines one.
- A write path that changes a ref without the rulesets being evaluated, other than the system writes listed below.
- Rejecting a push with a message that does not name the ref, the ruleset and the rule.
- Cost on repositories without rulesets. A push to a repository with no active ruleset runs no extra git commands and at most one indexed query.

## Model

A ruleset has:

- `name`, unique per repository.
- `target`: `branch` or `tag`.
- `enforcement`: `active` or `disabled`. A disabled ruleset is kept but never evaluated.
- `conditions.ref_name.include` and `conditions.ref_name.exclude`: lists of patterns.
- `bypass_actors`: a list of `{ actor_id, actor_type, bypass_mode }`.
- `rules`: a list of `{ type, parameters? }`. Each type appears at most once per ruleset. In this part, all five rule types take no parameters.

### Matching refs

- Patterns name the ref without its prefix. The prefix comes from `target`: `refs/heads/` for branches, `refs/tags/` for tags. GitHub's API also accepts the full ref (`refs/heads/main`). Accept both, store the full form, as GitHub does.
- Patterns use fnmatch: `*` matches within a path segment and does not cross `/`. `**` crosses `/`. `?` and `[...]` behave as in fnmatch. Match GitHub's documented examples exactly; they are the test cases.
- `~DEFAULT_BRANCH` matches the repository's current default branch. It is resolved at evaluation time, so renaming the default branch moves the protection with it.
- `~ALL` matches every ref of the target type.
- A ref is targeted when it matches at least one include pattern and no exclude pattern. An empty include list targets nothing.

### Several rulesets

Every active ruleset that targets a ref applies. The rules add up: if any applicable ruleset forbids a write, the write is refused. Bypassing one ruleset does not bypass another; the actor must be able to bypass every ruleset that would refuse the write.

### Rules

| Rule | Refuses |
|---|---|
| `creation` | creating a targeted ref |
| `update` | moving a targeted ref, by push or by merging a pull request into it |
| `deletion` | deleting a targeted ref |
| `non_fast_forward` | moving a targeted ref to a commit that does not contain its current one |
| `required_linear_history` | moving or creating a targeted ref so it reaches a merge commit it did not reach before |

Notes:

- `update` also blocks pull request merges into the ref unless the merger can bypass. This matches GitHub.
- `required_linear_history` makes the `merge` merge method unavailable for pull requests into the ref; `squash` and `rebase` stay. In this part the merge endpoint refuses it. The merge button showing only allowed methods comes with B.
- `creation` on a tag ruleset is how GitHub protects release tags. Creating a release whose tag does not exist yet creates the tag, so it is subject to `creation`.

### Bypass actors

| `actor_type` | `actor_id` | Who it covers |
|---|---|---|
| `RepositoryRole` | the role (`write`, `maintain`, `admin`) | anyone whose role on the repository is at least this |
| `Team` | the team id | members of that team |
| `OrganizationAdmin` | ignored (GitHub sends `1`) | organization administrators (`administers`) |

GitHub identifies the built-in repository roles by number (`2` maintain, `4` write, `5` admin, as GitHub's API and the Terraform provider use them; verify against a live GitHub response before release). Accept and return these numbers in the REST API, and map them to Ghost's roles. Teams are identified by a numeric id in REST, so `team` gains a `numeric_id` like `organization` has.

The repository owner of a personal repository counts as `admin`.

`bypass_mode`:

- `always`: the actor's writes skip the ruleset.
- `pull_request`: the actor skips the ruleset only when the write is a pull request merge. A direct push is still refused.

## Enforcement

### One evaluator

A pure function decides every write:

```ts
evaluateRulesets({ rulesets, actor, write, transitions, facts }): Violation[]
```

- `rulesets`: the repository's active rulesets.
- `actor`: who is writing, with their role, teams and organization admin status resolved.
- `write`: `push` or `pull_request_merge`. It decides `pull_request` bypass mode.
- `facts`: per ref, `isFastForward` and `introducesMergeCommit`, when the ref moves.
- Each `Violation` names the ref, the ruleset and the rule.

It does no I/O. Everything it needs is passed in, so every case can be unit tested.

### Where facts come from

**Git push.** The pushed commits exist only in the quarantine that `withVerifiedPack` builds (`lib/git/protocol/verify-push.ts`). Compute facts there, with the quarantine environment:

- `isFastForward`: `git merge-base --is-ancestor <old> <new>`.
- `introducesMergeCommit`: `git rev-list --min-parents=2 -n1 <new> --not --all`.

Compute them only for refs targeted by an active ruleset that has `non_fast_forward` or `required_linear_history`. Creation and deletion need no facts.

Evaluate in `git.service.ts` `commitToLog`, beside the existing `refs/pull/*` refusal, before `commitPush`.

**API writes.** These callers know their facts without git:

| Caller | Transition | Facts |
|---|---|---|
| `repository-branches.service` create | create | none |
| `repository-branches.service` delete | delete | none |
| `pull-requests.service` merge | update | fast-forward; merge commit when the method is `merge` |
| `reviews.service` apply suggestion | update of the head branch | fast-forward, no merge commit |
| `releases.service` create and delete tag | create or delete | none |

### Race safety

Facts are computed against the ref's current value, and `commitPush` refuses any transition whose `oldOid` no longer matches the live ref (`NonFastForwardError`). If the ref moves between the check and the commit, the commit fails. A verdict about an old value can never be applied to a new one.

### The guarantee

`commitPush` takes a required `actor`:

- `{ userId, verdict }` for user writes, where `verdict` is the result of evaluating the rulesets for these exact transitions.
- `'system'` for writes that bypass rulesets.

`commitPush` refuses a user write without a verdict, and refuses a verdict with violations. So a new caller that forgets the rulesets fails loudly in its first test rather than silently skipping them.

Only these callers may pass `'system'`:

- `repository-repair.service` (repairs replay existing history).
- `pull-refs.service` (`refs/pull/*` is never user-protected).
- `repositories.service` repository initialisation (no ruleset can exist yet).

Keep the list in one place, for example as a comment on the type, so review can catch an addition.

### Messages

A refused push reports, for each refused ref, GitHub's text:

```
remote: error: GH013: Repository rule violations found for refs/heads/main.
remote:
remote: - Cannot force-push to this branch
remote:
```

Use GitHub's wording for each rule. Collect it from GitHub's documentation or a real refusal; do not invent it. Each refused ref is reported as rejected in report-status. When some refs are refused, the whole push is refused, as with any other ref error today.

API writes return 422 with the same violation text, matching GitHub's REST response for a rule violation.

## Data

New tables in `packages/db/src/schema/rulesets.ts`. snake_case columns (0030), timestamptz (0018). Generate the migration with `bun db:generate`.

- `ruleset`: `id`, `repository_id` (cascade), `name`, `target`, `enforcement`, `include` and `exclude` (text arrays), `created_by_id`, `created_at`, `updated_at`. Unique on (`repository_id`, `name`). Organization rulesets will later add a nullable `organization_id` with exactly one owner set, so do not name columns or indexes as if the repository were the only owner.
- `ruleset_rule`: `ruleset_id` (cascade), `type`, `parameters` (jsonb). Unique on (`ruleset_id`, `type`).
- `ruleset_bypass_actor`: `ruleset_id` (cascade), `actor_type`, `role` (nullable), `team_id` (nullable, cascade), `bypass_mode`. A check constraint keeps exactly the column its type needs.

Rules could also live as one jsonb column on `ruleset`. Builder's call; the API shape is the same either way.

Loading rulesets for a push is one query by repository, using the index on `ruleset.repository_id`, filtered to `active`.

## API

REST, under the GitHub compat layer (`apps/api/src/github/rest/repos/`), with GitHub's paths and shapes:

- `GET /repos/{owner}/{repo}/rulesets`: read access. `includes_parents` is accepted and ignored until organization rulesets exist.
- `POST /repos/{owner}/{repo}/rulesets`: admin.
- `GET /repos/{owner}/{repo}/rulesets/{ruleset_id}`: read access. Bypass actors only for admins, as on GitHub.
- `PUT /repos/{owner}/{repo}/rulesets/{ruleset_id}`: admin.
- `DELETE /repos/{owner}/{repo}/rulesets/{ruleset_id}`: admin.
- `GET /repos/{owner}/{repo}/rules/branches/{branch}`: read access. The rules that apply to that branch, each with `ruleset_source_type`, `ruleset_source` and `ruleset_id`.

The web app uses Ghost's own API under `repositories/:username/:repo/rulesets`, following the existing controllers. Validation errors are 422 with GitHub's messages: an unknown rule type, an unknown actor, a duplicate rule type, or a duplicate name.

Every create, update and delete writes an outbox event, ready for the `repository_ruleset` webhook. Delivering the webhook is part of the webhook work, not this part.

## Web

A **Rules** section in repository settings, admins only:

- **List:** name, target, enforcement, the number of rules, and the number of matching refs.
- **Form:**
  - name, target, and enforcement.
  - include and exclude patterns, with chips for `~DEFAULT_BRANCH` and `~ALL`.
  - bypass actors: a picker for roles, teams and organization admin, each with its mode.
  - the five rules as checkboxes with GitHub's descriptions.
- **Pattern preview:** as patterns change, list the existing branches or tags they target, using the same matcher as enforcement. Reuse `BranchSelect`'s searching and virtualisation, because a repository can have thousands of refs.
- **Branch and tag pages:** mark protected refs, and disable the delete button with the reason when `deletion` applies to the viewer.

## Testing

- Unit: the matcher against GitHub's documented examples, including `*` versus `**`, `~DEFAULT_BRANCH` and `~ALL`, and exclude winning over include.
- Unit: the evaluator, covering each rule, several rulesets adding up, each bypass actor type, `always` versus `pull_request` mode, and disabled rulesets.
- Integration: each API write path refused and allowed (branch create and delete, pull request merge, suggestion commit, release tags), and the system paths not refused.
- Integration: `commitPush` refuses a user write without a verdict.
- e2e with the git binary: force-push, delete and create refused with the GH013 message; a fast-forward allowed; a push bringing in a merge commit refused under linear history; a bypass actor allowed.
- Integration: a race where the ref moves after facts are computed fails the commit.
- REST: the rulesets endpoints compared field by field with GitHub's documented responses.
- Run the full API suite only against a throwaway Postgres, never the dev database.

## Builder's calls

- Rules as a table or as jsonb.
- Id prefix for rulesets. REST returns a number on GitHub; follow whatever the compat layer does for other numbered ids.
- The matcher implementation, as long as it passes GitHub's examples.
- Exact UI layout, within GitHub's patterns.
- Where the actor's role, teams and organization admin status are resolved, as long as it is once per write.

## Build steps

Do them in this order. Each step ends with tests that turn green, so you always know where you stand. The enforcement suites create their rulesets through the Ghost API, which is why the API comes before enforcement.

### 1. Match refs (done)

Turn a pattern into its stored form, and decide whether a ruleset targets a ref. Check the ref type first: a ref outside the ruleset's namespace is never targeted. `~ALL`, `~DEFAULT_BRANCH` and globs go through the same matcher for include and exclude.

Done when `ref-pattern.spec.ts` is green.

### 2. Decide a write (done)

The pure evaluator. For each active ruleset the actor cannot bypass, and each targeted transition, classify the move as create, update or delete, and report every rule it breaks. Missing facts break the rule.

Done when `evaluate-rulesets.spec.ts` is green.

### 3. Errors (done)

`RulesetVerdictRequiredError` (a caller bug, 500) and `RulesetViolationError` (422, carries the violations, names each ruleset).

### 4. Store rulesets (done)

1. Add the three tables from Data.
2. Give rulesets a numeric id for REST, the way other numbered resources do in the compat layer.
3. Add `numeric_id` to `team`.
4. Run `bun db:generate`, then apply the migration to a throwaway database.

Done when the migration applies cleanly and the existing suites still pass.

### 5. Manage rulesets through the Ghost API

1. Validate the body at the boundary. Each mistake gets the status code the contract gives it: 400, 409 or 422.
2. Store patterns through `normalizeRefPattern`.
3. Check permissions. Reads need read access, changes need admin, and `bypassActors` is hidden from non-admins.
4. On create, edit and delete, write the outbox event in the same transaction as the change.
5. Add `preview`. It lists the repository's branches or tags and keeps those `refTargeted` accepts.
6. Add `protected-refs`, which needs the viewer's bypass status for each ruleset. The evaluator already decides bypass inline. Move that logic into one exported function in `lib/rulesets` that answers `always`, `pull_requests_only` or `never`, so the evaluator, `protected-refs` and REST `current_user_can_bypass` share one copy.

Done when `rulesets.e2e-spec.ts` is green.

### 6. Make every write carry a verdict

1. Write one service method that a writer calls before committing. It:
   - loads the repository's active rulesets in one query;
   - resolves the actor once (role, team ids, organization admin), with a personal repository's owner as `admin`;
   - runs the evaluator and returns `{ transitions, violations }`.

   When the repository has no active rulesets, it returns a clean verdict without resolving the actor.
2. Replace `pushedBy` on `commitPush` with the required `actor`. Before anything is stored, refuse in this order:
   - no actor;
   - a user actor without a verdict;
   - a verdict whose transitions are not the same set as the ones being written;
   - a verdict with violations.

   Compare sets by ref, old oid and new oid. Record `actor.userId` where `pushedBy` went.
3. Write the list of callers allowed to pass `'system'` as a comment on the actor type: repair, pull refs, repository initialisation.
4. Compile. Every caller that no longer type-checks is a write path to wire up in steps 7 and 8. Use that list as your checklist.
5. In the existing tests that call `commitPush` directly, add `actor: 'system'` or a clean verdict. Change nothing else in them.

Done when `push-transaction.rulesets.spec.ts` and `push-transaction.service.spec.ts` are green.

### 7. Enforce on git push

1. In `withVerifiedPack`, while the quarantine exists, compute facts. Only do it for refs that an active ruleset with `non_fast_forward` or `required_linear_history` targets. With no such ruleset, run no extra git command.
2. In `commitToLog`, beside the `refs/pull/*` refusal, get the verdict. If it has violations:
   - refuse the whole push;
   - print `GH013: Repository rule violations found for <ref>` and each violation's message and ruleset for every refused ref;
   - mark every refused ref rejected with `push declined due to repository rule violations`.

   Otherwise, pass the verdict to `commitPush`.

Done when the git push tests in `rulesets-enforcement.e2e-spec.ts` are green.

### 8. Enforce on API writes

For each caller in the API writes table, build the transitions, supply the facts it knows, get the verdict, and pass it to `commitPush`. `RulesetViolationError` already maps to 422 through the domain error filter.

1. Branch create and delete.
2. Release tag create and delete.
3. Pull request merge, as a `pull_request_merge` write. Under `required_linear_history`, the `merge` method is refused, because it introduces a merge commit; `squash` and `rebase` pass.
4. Suggestion apply on the head branch.
5. Repair, pull refs and repository initialisation pass `'system'`.

`~DEFAULT_BRANCH` must come from the repository row at write time, never from a cache that a default branch change leaves stale.

Done when all of `rulesets-enforcement.e2e-spec.ts` is green.

### 9. GitHub REST

1. Add the endpoints from API, built on the same service as step 5.
2. Map role ids `2`, `4` and `5` to `maintain`, `write` and `admin`, and back.
3. Map team `numeric_id` to the team, and use `1` for `OrganizationAdmin`.
4. Make `PUT` partial.
5. Return 422 with a `message` for every invalid body.
6. Return summaries in the list.
7. Answer `current_user_can_bypass` from the shared bypass function.
8. For `rules/branches/{branch}`, accept a branch name containing `/`.

Done when `github-rulesets.e2e-spec.ts` is green.

### 10. Close out

1. Run the full API suite, unit and e2e, against throwaway Postgres and RustFS.
2. Check the cost anti-goal by hand: a push to a repository without rulesets runs no extra git command and at most one query.
3. Replace the four unverified rule messages with GitHub's wording.
4. Then hand over for review.

## Contract fixed by the tests

The failing tests written before the build pin these names and shapes. Change them only together with the tests.

### Modules

- `apps/api/src/lib/rulesets/ref-pattern.ts`: `normalizeRefPattern(target, pattern)` returns the stored form, and `refTargeted({ target, include, exclude }, ref, defaultBranch)` returns a boolean.
- `apps/api/src/lib/rulesets/evaluate-rulesets.ts`: `evaluateRulesets({ rulesets, actor, write, transitions, facts, defaultBranch })` returns `Violation[]`. `facts` is a `Map<ref, RefFacts>`. A rule that needs facts which were not supplied counts as broken (fail closed).
- `apps/api/src/lib/rulesets/rulesets.types.ts`:
  - `RuleType`: the five rule names.
  - `Ruleset`: `{ id, name, target, enforcement, include, exclude, bypassActors, rules: { type, parameters? }[] }`.
  - `BypassActor`: `{ actorType: 'RepositoryRole', role: 'write' | 'maintain' | 'admin', bypassMode }`, `{ actorType: 'Team', teamId, bypassMode }`, or `{ actorType: 'OrganizationAdmin', bypassMode }`. `bypassMode` is `'always'` or `'pull_request'`.
  - `RulesetActor`: `{ role: Role | null, teamIds: string[], organizationAdmin: boolean }`. A personal repository's owner resolves to `admin`.
  - `RefFacts`: `{ isFastForward, introducesMergeCommit }`.
  - `Violation`: `{ ref, rulesetId, rulesetName, rule, message }`.
- `apps/api/src/lib/rulesets/rulesets.errors.ts`: `RulesetVerdictRequiredError` and `RulesetViolationError`. `RulesetViolationError` carries `violations` and maps to 422.
- `commitPush` takes `actor: { userId, verdict: { transitions, violations } } | 'system'`. A missing actor, a user actor without a verdict, or a verdict for transitions other than exactly the ones being written throws `RulesetVerdictRequiredError` before anything is stored. "Exactly" means the same set of ref, old oid and new oid. A verdict with violations throws `RulesetViolationError`. The acting user is recorded as the pusher.
- The only message wording pinned is the force-push one, `Cannot force-push to this branch`. Take the others from GitHub, as above.

### Messages

- A refused push prints `GH013: Repository rule violations found for <ref>`, then each violation, and each violation names its ruleset. Report-status reason: `push declined due to repository rule violations`.
- A refused API write answers 422, and its `message` names the ruleset.

### Ghost API

Under `/api/repositories/:owner/:repo`:

| Endpoint | Who | Answers |
|---|---|---|
| `GET /rulesets` | read | `{ rulesets }` |
| `POST /rulesets` | admin | 201 with the ruleset |
| `GET /rulesets/:id` | read | the ruleset |
| `PUT /rulesets/:id` | admin | 200, replaces the whole ruleset |
| `DELETE /rulesets/:id` | admin | 204 |
| `POST /rulesets/preview` | admin | `{ target, include, exclude }` gives `{ refs }`: the existing full refs it targets, sorted |
| `GET /protected-refs?target=branch\|tag` | read | `{ refs: { [ref]: { rules, bypass } } }`, where `rules` are the active rule types and `bypass` is `always`, `pull_requests_only` or `never` for the viewer |

- A ruleset is `{ id, name, target, enforcement, include, exclude, bypassActors, rules, createdAt, updatedAt }`, with patterns in stored form. `bypassActors` is left out for viewers who are not admins.
- Status codes:
  - 400 for a malformed body: empty name, unknown target, enforcement, rule type, actor type, role or mode; a duplicate rule type; a role below `write`.
  - 422 for a team that is not on the owning organization, or a Team or OrganizationAdmin actor on a personal repository.
  - 409 for a name that is already taken.
  - 401 when signed out, 403 for non-admins making changes, 404 for a ruleset of another repository.
- Outbox events `repository_ruleset.created`, `repository_ruleset.edited` and `repository_ruleset.deleted` carry `rulesetId` in their payload.

### GitHub REST

- `id` and team `actor_id` are numeric. The ruleset needs a numeric id, and `team` gains `numeric_id`.
- `OrganizationAdmin` uses `actor_id` `1`.
- `PUT` updates only the fields it is given.
- Every invalid body answers 422 with a `message`.
- `current_user_can_bypass` is `always`, `pull_requests_only` or `never`.
- The list returns summaries: no rules, conditions or bypass actors.
- `_links.html` points at `/<owner>/<repo>/rules/<id>`.

### Existing tests

Existing tests that call `commitPush` directly (the branches, releases and commit-status integration specs, and `push-transaction.service.spec.ts`) need an `actor` argument once it is required. That is the only change allowed to them: pass `'system'` or a clean verdict, and leave their assertions alone.
