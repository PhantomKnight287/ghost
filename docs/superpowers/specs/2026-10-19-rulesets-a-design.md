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

GitHub identifies repository roles by number (`1` maintain, `2` write, `5` admin). Accept and return GitHub's numbers in the REST API, and map them to Ghost's roles.

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
