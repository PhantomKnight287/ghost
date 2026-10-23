# Repository rulesets: rule insights and evaluate mode

Issue: #94 on Ghost (parent: #17). Builds on part A (`2026-10-19-rulesets-a-design.md`, Ghost #91) and part B (`2026-10-21-rulesets-b-design.md`, Ghost #95). Organization-wide rulesets and insights are tracked separately as Ghost #97.

The principle of parts A and B carries over: copy GitHub as closely as possible. Where this document is silent, do what GitHub does. Where it says "verify", check against a real GitHub repository before release; if GitHub differs, follow GitHub and update this document.

## Intent

Rulesets decide every protected write, but nothing remembers what they decided. A bypassed `git push` is only shown to the pusher as a sideband notice; a refused push leaves no trace at all. Part B records a bypassed merge on the pull request timeline, but nothing else.

Rule insights is a durable, per-repository history of ruleset evaluations. It serves three needs, all of which the user wants:

1. **Admin audit.** An admin notices a commit on `main` that never went through a pull request and needs to find out who pushed it, when, and which rule they bypassed.
2. **Explaining refusals.** When a contributor's push is refused, an admin can see exactly which ruleset and rule refused it. (Insights is admin-only, so contributors still learn why from the refusal message itself; opening insights to others is a later request, not this work.)
3. **GitHub parity.** The data, the Insights view and the `rule-suites` REST endpoints match GitHub, so `gh`, scripts and integrations written against GitHub work unchanged.

Alongside it comes GitHub's **evaluate** enforcement: a ruleset that is checked and recorded but never blocks, so an admin can trial a ruleset and watch in Insights what it would have refused before turning it on.

## Goals

1. A third enforcement value, `evaluate`, next to `active` and `disabled`, everywhere enforcement appears: settings form, ruleset list, Ghost API, GitHub REST rulesets API, GraphQL `RuleEnforcement.EVALUATE`.
2. Every real write checked against at least one `active` or `evaluate` ruleset leaves a record (a **rule suite**), whether it passed, failed or was bypassed.
3. Each rule suite lists every rule that was checked (a **rule evaluation**), with its ruleset, enforcement at the time, rule type, pass or fail, and the message the user saw.
4. An admin-only **Insights** tab in Settings › Rules showing rule suites as a timeline, with filters.
5. GitHub's `GET /repos/{owner}/{repo}/rulesets/rule-suites` and `GET /repos/{owner}/{repo}/rulesets/rule-suites/{rule_suite_id}`, with GitHub's shapes, filters and pagination.

## Non-goals

- Organization rulesets and organization insights (Ghost #97).
- The rule insights dashboard charts (GitHub Team/Enterprise only).
- Showing insights to anyone but repository admins.
- Retention or cleanup. Records are kept forever; they are small rows.
- Required status checks and signature rules (parts C and D); their evaluations appear here when those parts land.

## Anti-goals

- **Recording what was not a write.** The merge box and `GET pulls/:n/merge-requirements` evaluate rulesets on every page load. Those must never create a rule suite; only an actual write attempt does. A page refresh that adds a row to the audit log makes the log useless.
- **Losing a refusal.** A refused push or merge must be recorded even though nothing landed. If recording rides on the write's own transaction, a refusal rolls its record back with it; it must not.
- **Evaluate mode that blocks.** An `evaluate` ruleset never refuses a write, never asks for a bypass, never removes a merge method, and never marks approvals stale.
- **A slower push for unprotected repositories.** A repository with no active or evaluate rulesets must still cost one query and nothing more, as part A promised.

## Evaluate enforcement

- New enum value `evaluate` on `ruleset_enforcement`.
- The evaluator checks `evaluate` rulesets the same way as `active` ones, but their failures never become violations or bypasses. They only appear as failed rule evaluations and in `evaluation_result`.
- Bypass lists do not apply to `evaluate` rulesets: a failed evaluate rule is a `fail`, whoever the actor is. (Agreed with the user as a guess. **Verify** against GitHub; if GitHub reports `bypass` for an evaluate ruleset the actor could bypass, follow GitHub.)
- Everything that reads only `active` today keeps reading only `active` for enforcement: `allowedMergeMethods`, the merge requirements, stale approvals, the protected-ref badge, the `gh` fields (`branchProtectionRule`, `reviewDecision`, `mergeStateStatus`, `mergeable_state`). GitHub's "rules for a branch" endpoint (`GET /repos/{o}/{r}/rules/branches/{branch}`) — **verify** whether GitHub includes evaluate rulesets there and match it.
- Web form: the enforcement select gets "Evaluate" with the hint "Records what would pass or fail without blocking anything." The ruleset list shows an "Evaluate" badge the way it shows "Disabled".

## What gets recorded

### When

One rule suite per targeted ref per real write attempt that was checked against at least one `active` or `evaluate` ruleset targeting that ref. Real write attempts are:

- `git push` (one suite per ref the push touches that some ruleset targets);
- branch creation and deletion from the web/API;
- tag creation and deletion, including through releases;
- applying a review suggestion;
- a pull request merge, through the web, the Ghost API, REST or GraphQL.

Not recorded:

- refs no `active`/`evaluate` ruleset targets;
- `system` writes (`RefWriter = 'system'`: repairs, `refs/pull/*`, repository initialisation);
- merge requirements computed for display (merge box, `merge-requirements`, `gh pr view`, `gh pr status`);
- a write that never reached the ruleset check, for example a push refused earlier for lacking write access or a bad pack;
- a write the rulesets allowed (`pass` or `bypass`) that then failed for another reason: a stale old OID (`NonFastForwardError`), log contention, an unreplayable ref, a storage quota refusal, or the merge transaction's draft/not-open re-check. Nothing landed and no ruleset refused it, so there is nothing to audit. *(Claude's call: a `pass` or `bypass` record must mean the write landed, so "who put this commit on `main`" is always answered truthfully.)*
- a merge refused only because the actor could bypass every failure but did not opt in (`RulesetBypassRequiredError`). That refusal is a confirmation prompt, not a decision; the retry with `bypassRules` records the `bypass`. GitHub has no such step. *(Claude's call.)*

### Result

- `result`: the verdict counting `active` rulesets only.
  - `pass`: no active rule failed; the write landed.
  - `bypass`: at least one active rule failed and every failure was bypassed; the write landed.
  - `fail`: at least one active rule failed and was not bypassed; the rulesets refused the write.
- `evaluation_result`: the same verdict with `evaluate` rulesets counted as if active (bypass lists aside, see above). `null` when no evaluate ruleset applied, as GitHub allows on the single-suite response.

A push that changes several refs records one suite per ref, each with its own result. If one ref fails, git refuses the whole push; every ref's suite is still recorded, and refs that passed keep `pass` (**verify** what GitHub records for the passing refs of a refused multi-ref push).

### Fields

Rule suite:

- repository
- actor (user; nullable: a push whose transport named no user, or a deleted user) and the actor's login at the time, for `actor_name`
- ref (full, `refs/heads/...` or `refs/tags/...`)
- `before_sha`, `after_sha` (zero SHA for create/delete, as git reports)
- write: `push` or `pull_request_merge`; for a merge, the pull request
- `result`, `evaluation_result`
- time (`pushed_at`)
- a GitHub-style integer id (the `numericId` pattern used by rulesets, releases and pull requests)

Rule evaluation, one per rule of every `active` or `evaluate` ruleset targeting that ref, as GitHub's `rule_evaluations` has one entry per rule. A rule that cannot break on this write (the `creation` rule on an update, the `pull_request` rule on a create or delete) is listed as `pass`. *(Claude's call; **verify** that GitHub lists such rules rather than leaving them out, and follow GitHub.)* Fields:

- ruleset (nullable reference, set null when the ruleset is deleted) plus a copy of the ruleset name at the time
- enforcement at the time: `active` or `evaluate`; reported as `deleted ruleset` once the ruleset is gone
- rule type, and for a failed `pull_request` rule the unmet requirements (the `Requirement` values of today's `Violation.requirement`), so one row holds all of them
- `pass` or `fail`
- `details`: the message the user saw for a failure, with a `pull_request` rule's several unmet requirements joined one per line in the evaluator's order; null for a pass
- for a merge, GitHub's `metadata.pull_request` (id, number, user, reviews) is built at read time from the pull request, when `include_metadata=true` (**verify** whether GitHub snapshots reviews at evaluation time; if so, snapshot them).

Deleting a repository deletes its rule suites.

### Where recording happens

`RulesetVerdictsService.judge` is shared by real writes and by display-only merge requirements, so recording cannot live inside `judge`. It must happen where a write is attempted with its verdict: the point where `commitPush` accepts or refuses a verdict, and the merge path that refuses before `commitPush` is reached. The builder chooses the exact seam; the constraints are:

- every recorded write in "When" above, and none of the exclusions;
- the record is written once the outcome is known: after the write lands for `pass`/`bypass`, at the refusal for `fail`;
- a refusal is recorded even though the write's transaction rolls back or never starts;
- a write must not fail because recording failed: log and carry on, as `recordPush` does;
- one record per attempt: a retried CAS or a retry inside the same request must not double-record.

### What the evaluator must return

Today `evaluateRulesets` returns only broken rules (`violations`, `bypassed`). Insights needs every rule checked, passing ones included, and evaluate rulesets' results kept separate from enforcement. The evaluator's output grows to carry that; `violations` and `bypassed` keep their current meaning so existing callers do not change behaviour.

## Insights view

- Settings › Rules gets two tabs: **Rulesets** (today's list) and **Insights**. Non-admins see neither the tab nor its data; the URL returns 404 for them, like other admin settings.
- Timeline, newest first, grouped by day ("Today", "Yesterday", dates). Each row: result icon, actor, "pushed to `ref`" or "merged #N into `ref`", short before → after SHAs, result badge (Passed / Failed / Bypassed), relative time.
- A row whose `result` is `pass` but `evaluation_result` is `fail` shows an "evaluate: would fail" badge.
- Clicking a row expands it in place (layout A, chosen by the user): rules grouped by ruleset, each ruleset labelled with its enforcement ("evaluate" badge for evaluate rulesets, "deleted" for deleted ones), each rule with ✓ or ✗ and the message.
- Filters: ruleset, ref, actor, result (all / pass / fail / bypass), enforcement (all / active / evaluate), time (last hour / day / week / month, default day, as GitHub's API; plus "all time" on the web page only, since records are kept forever).
- Paginated (load more), as GitHub's `per_page`/`page`.

## API

### GitHub REST

Both endpoints admin-only (GitHub requires "Administration: read"; a fine-grained token / OAuth scope mapping follows whatever the existing rulesets REST endpoints do). 404 for non-admins, as GitHub hides admin resources.

`GET /repos/{owner}/{repo}/rulesets/rule-suites`

- Query: `ref` (no wildcards; `refs/heads/` or `refs/tags/` prefix optional), `time_period` (`hour`, `day` default, `week`, `month`), `actor_name`, `rule_suite_result` (`pass`, `fail`, `bypass`, `all` default), `evaluate_status` (`all` default, `active`, `evaluate`), `per_page` (default 30, max 100), `page`.
- Response: array of `{ id, actor_id, actor_name, before_sha, after_sha, ref, repository_id, repository_name, pushed_at, result, evaluation_result }`.

`GET /repos/{owner}/{repo}/rulesets/rule-suites/{rule_suite_id}`

- Query: `include_metadata` (default false; capped at 50 entries, as GitHub).
- Response: the list fields plus `rule_evaluations: [{ rule_source: { type: "ruleset", id, name }, enforcement, result, rule_type, details, metadata? }]`.

Ids, `actor_id` and `repository_id` follow the existing GitHub layer's integer mappings. **Verify** the exact semantics of `evaluate_status` filtering and the `rule_source.type` value against GitHub.

### Ghost API

Admin-only endpoints for the web page: list with the web filters (including ruleset and all time) and pagination, and per-suite detail (or detail embedded in the list; builder's call). Documented in OpenAPI like the rest.

## Testing

Follows the agreed workflow: Claude writes the red tests, the user greens them, Claude audits.

- Unit: evaluator reports every checked rule with pass/fail; evaluate rulesets never produce violations or bypasses; `result`/`evaluation_result` derivation for every combination.
- e2e: each write path in "When" records exactly one suite per targeted ref with the right result; a refused push and a refused merge are recorded; merge requirements, the merge box and `gh pr view` record nothing; unprotected refs and `system` writes record nothing; a deleted ruleset reads as `deleted ruleset` with its old name; a renamed ruleset keeps its old name on old records.
- e2e: evaluate ruleset trial: does not block a push or merge, does not change allowed merge methods or `mergeStateStatus`, appears in insights with `evaluation_result: fail`.
- e2e: REST filters and pagination; admin-only (non-admin 404); GitHub REST and GraphQL round-trip `evaluate`.

## Builder's calls

- Table and column names; whether rule evaluations are a child table or JSON on the suite (filters by ruleset must stay indexable either way).
- The exact seam for recording, within the constraints above.
- The Ghost API's shape for the web page.
- How "all time" and grouping by day handle time zones (viewer's local time is the sensible default).

## Still to verify against GitHub

- Whether bypass lists apply to evaluate rulesets in `evaluation_result`.
- Whether evaluate rulesets appear in `GET /repos/{o}/{r}/rules/branches/{branch}`.
- What is recorded for the passing refs of a refused multi-ref push.
- Whether GitHub lists rules that could not break on a write (`creation` on an update) in `rule_evaluations`.
- `rule_source.type` value and `evaluate_status` filter semantics.
- Whether pull request reviews in `metadata` are snapshotted at evaluation time.
