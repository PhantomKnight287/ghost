# Repository rulesets, part B: the pull request rule and merge blocking

Issue: #88 on Ghost, #141 on GitHub (parent: #17 on Ghost, #62 on GitHub). Builds on part A (`2026-10-19-rulesets-a-design.md`, merged as Ghost #91) and on review requests and CODEOWNERS (Ghost #86).

Part A's principle carries over unchanged: copy GitHub as closely as possible. Where this document is silent, do what GitHub does. Where it says "verify", check the behaviour against a real GitHub repository before release; if GitHub turns out to differ from what is written here, follow GitHub and update this document.

## Intent

Part A protects the ref itself. It does not let a team say "every change to `main` goes through a reviewed pull request". Part B adds GitHub's `pull_request` rule, which does.

The motivating case is Ghost hosting itself as `ghost/ghost`, with a ruleset on `main` that:

- refuses a direct `git push` to `main` from anyone not on the bypass list;
- requires a review from the code owners when a pull request touches `packages/db`;
- requires every review thread to be resolved, including the ones bots such as CodeRabbit open;
- makes an approval stale when new commits are pushed, so the reviewer has to approve again.

When a merge is blocked, the person sees every unmet requirement at once, both on the merge box and through the API that `gh` uses.

## Goals

1. The `pull_request` rule with all of GitHub's parameters except those listed in Non-goals:
   - `required_approving_review_count`
   - `dismiss_stale_reviews_on_push`
   - `require_code_owner_review`
   - `require_last_push_approval`
   - `required_review_thread_resolution`
   - `allowed_merge_methods`
2. A direct push that updates a ref targeted by a `pull_request` rule is refused with GH013, as in part A.
3. A pull request merge into a targeted ref is refused while any requirement is unmet, and the refusal lists every unmet requirement.
4. Review threads can be resolved and unresolved, in the web app, through Ghost's API and through GitHub's GraphQL API.
5. Bypass works as on GitHub. A bypass actor sees the unmet requirements and has to opt in to merging over them in the web app. Every bypassed merge is recorded on the pull request; a bypassed push prints a notice.
6. The gh compat fields tell the truth:
   - GraphQL: `reviewDecision`, `mergeStateStatus`, `Ref.branchProtectionRule` and `repository.rulesets`;
   - REST: `mergeable_state`;
   - a blocked merge answers 405 on REST and errors on GraphQL.
7. The merge button offers only the merge methods the rulesets allow.

## Non-goals

- `required_status_checks` (part C) and `required_signatures` (part D). `mergeStateStatus` `BEHIND` and `UNSTABLE` come with C.
- GitHub's preview parameters on `pull_request`: `required_reviewers` and `automatic_copilot_code_review_enabled`. Ghost has no Copilot. The extra approval GitHub requires for unattributed Copilot pull requests does not apply either.
- Merge queues and auto-merge.
- "Update branch" (merging the base into the head, REST `PUT /pulls/{n}/update-branch`, GraphQL `updatePullRequestBranch`). Ghost does not have it yet; it is a separate issue.
- Rule insights (Ghost #94).
- Organization rulesets (unchanged from A).
- Classic branch protection and its REST API (unchanged from A).
- A REST endpoint to resolve a thread. GitHub has none; resolving is GraphQL only.

## Anti-goals

- Showing only the first unmet requirement. Every surface (merge box, Ghost API, REST 405, GraphQL error) lists all of them.
- A merge path, of any API, that skips the pull request requirements.
- An approval being counted after it went stale just because the outbox has not caught up. The merge check judges staleness itself.
- Cost on repositories without rulesets. Viewing or merging a pull request in a repository with no active `pull_request` rule runs no extra git command and adds no queries beyond part A's one.
- A bypassed merge that leaves no trace. A bypassed push is shown to the pusher through the sideband notice only: GitHub records push bypasses in rule insights, which part A left out, so B does not add a repository audit record. Rule insights are tracked in Ghost #94.

## The `pull_request` rule

### Parameters

| Parameter | Type | Meaning |
|---|---|---|
| `required_approving_review_count` | integer 0 to 10 | approvals needed |
| `dismiss_stale_reviews_on_push` | boolean | new reviewable commits dismiss earlier approvals |
| `require_code_owner_review` | boolean | each changed path that has code owners needs one of its owners' approval |
| `require_last_push_approval` | boolean | the most recent reviewable push must be approved by someone other than whoever pushed it |
| `required_review_thread_resolution` | boolean | every review thread must be resolved |
| `allowed_merge_methods` | non-empty subset of `merge`, `squash`, `rebase` | which merge methods may be used |

Defaults, the REST validation messages and which parameters are required in a REST body: take them from GitHub's REST schema for repository rulesets.

### Several rulesets

As in part A, everything adds up:

- the required approval count is the highest of all applicable rules;
- each boolean is on if any applicable rule turns it on;
- the allowed merge methods are the intersection of every applicable rule's methods;
- `required_linear_history` from part A also removes `merge`.

If the intersection is empty, nothing can merge without a bypass. Each violation still names the ruleset that caused it.

### What counts as an approval

An approval counts when all of these hold:

- it is the reviewer's latest submitted, non-dismissed verdict on the pull request;
- the reviewer is not the pull request's author. GitHub: "Pull request authors cannot approve their own pull requests";
- the reviewer has write access to the base repository now, not only when they reviewed;
- with `dismiss_stale_reviews_on_push`, it is not stale (see below).

A `changes_requested` verdict from a reviewer with write access blocks the merge while it stands, as on GitHub. Removing the block takes that reviewer's approval or a dismissal.

### Stale approvals

GitHub dismisses an approval when new reviewable commits change the pull request's diff after it. A push to the head that leaves the diff unchanged, such as a rebase with no conflicts, does not dismiss.

A move of the base also makes approvals stale, for example when another pull request merges into it (decided with the user). Any move of the base tip after the approval counts, whether or not the new base commits touch the pull request's files. Verify against GitHub whether it only dismisses when the files overlap; if so, narrow this to match.

- **At merge time** the check is authoritative. An approval is stale when either holds:
  - the base tip has moved since the approval: the base sha recorded on the review differs from the current base tip;
  - the diff from the approved head commit's merge base to that commit differs from the diff from the current merge base to the current head.

  An approval whose commit is no longer in the repository is stale. How to compare diffs is the builder's call (for example `git patch-id --stable`). It must be correct for the plain case: a new commit makes earlier approvals stale.
- **For the record**, an outbox consumer on `pull_request.synchronized` dismisses stale approvals, the way `CodeownerRequestsService` already consumes that event:
  - it sets `dismissalMessage` with `dismissedById` null, which marks a system dismissal;
  - it emits `pull_request.review_dismissed`.

  It also consumes pushes to a base branch: a base move dismisses approvals on every open pull request into that branch, including the moves that merges make.

  The merge never waits on this consumer.

### Most recent push

`require_last_push_approval` needs to know who pushed the head's most recent reviewable commit.

- Ghost does not record this today. Add `pull_request.headPushedById`. Set it whenever the head moves through a user write: git push or suggestion apply. When a merge into one branch moves another request's head, the merger is the pusher.
- The requirement holds when at least one counting approval exists on the current head (or on a commit with the same diff) from someone other than `headPushedById`.
- A null pusher (an unknown transport user, or a deleted account) does not satisfy the requirement.

### Code owners

- Read CODEOWNERS from the base branch at the base tip, never from the head, as `CodeownerRequestsService` already does.
- The changed files are those between the merge base and the head.
- For each changed file, `matchingRule` gives its owners. A file with no rule, or whose owners all resolve to null (unknown, or no write access), needs no code owner review. This matches GitHub, which ignores owners without write access.
- A file is satisfied by a counting, non-stale approval from:
  - a user owner, or
  - a member of a team owner.

  The author never satisfies it, so a sole code owner's own pull request is blocked unless they can bypass. This is deliberate. GitHub has no setting for this case, and the bypass list is the answer.
- A CODEOWNERS file with errors still applies the rules that parsed (verify against GitHub).
- The violation names the files or patterns still waiting and their owners, in GitHub's wording.

### Conversation resolution

With `required_review_thread_resolution`, every review thread on the pull request must be resolved. That includes outdated threads and threads from bots and apps.

### Direct pushes

On a `push` write, the `pull_request` rule refuses an update of a targeted ref with GitHub's message, `Changes must be made through a pull request.`

Verify against GitHub whether the rule also refuses creating or deleting a targeted ref. The expected answer is no, since part A's `creation` and `deletion` rules cover those.

The suggestion apply path from part A is a `push` write to the head branch. If the head branch is itself targeted by a `pull_request` rule, the suggestion is refused.

## Review threads

There is no thread resolution today. Add it:

- **Data:** a thread is its root comment, the one with `inReplyToId` null. Add `resolvedById` (set null on delete) and `resolvedAt` to `pull_request_review_comment`, used only on root comments. A separate thread table is the builder's call. The API shape is the same either way.
- **Who can resolve or unresolve:** the pull request's author and anyone with write access, as GitHub's docs say. The thread's own author can do so only if they are one of those.
- **Ghost API:** resolve and unresolve endpoints. Thread state appears wherever review comments are returned.
- **GraphQL:**
  - `PullRequest.reviewThreads`, a connection of `PullRequestReviewThread` with `id`, `isResolved`, `isOutdated`, `isCollapsed`, `resolvedBy`, `viewerCanResolve`, `viewerCanUnresolve`, `path`, `line` and `comments`;
  - the mutations `resolveReviewThread` and `unresolveReviewThread`.

  Match GitHub's schema for every field Ghost supports. CodeRabbit and other bots resolve threads through these mutations.
- **Events:** outbox events `pull_request_review_thread.resolved` and `.unresolved`, ready for the webhook of that name. Delivery belongs to the webhook work.
- **Web:** resolve and unresolve buttons on threads, in the files view and the conversation. Resolved threads are collapsed, as on GitHub.

## Enforcement

### The evaluator

`evaluateRulesets` stays pure. It gains:

- the `pull_request` rule type;
- an optional `pullRequest` input of pull request facts for `pull_request_merge` writes;
- a `bypassed` result, so a bypass can be shown and recorded instead of disappearing.

The fact shape is the builder's call. The facts must be enough to produce every violation listed above with its detail, for example the approval count, standing change requests, the code owner paths still waiting and their owners, the unresolved thread count, whether the last push is approved, and the merge method.

Missing pull request facts break the rule (fail closed), as missing ref facts do in part A.

Today the evaluator silently skips a ruleset the actor can bypass. B changes that. Each violation is computed whether or not the actor can bypass it, and is then split into:

- `violations`: not bypassable by this actor for this write. They refuse the write.
- `bypassed`: bypassable. They are allowed, shown and recorded.

`commitPush` still refuses only on `violations`.

This changes part A's evaluator contract and its tests. Update both together, and keep every part A behaviour the same apart from the new `bypassed` list.

### Where pull request facts come from

One service method computes the facts for a pull request. It runs only when an active ruleset with a `pull_request` rule targets the base ref. It reads:

- the reviews and review threads;
- `headPushedById`;
- CODEOWNERS and the changed files, the only git work, done only with `require_code_owner_review`;
- the diff identity, only with `dismiss_stale_reviews_on_push` or `require_last_push_approval`.

Merging, the merge box, `mergeStateStatus`, `reviewDecision` and REST `mergeable_state` all use this one method, so they cannot disagree.

On list queries (`gh pr list`, `gh pr status` ask for `reviewDecision` and `mergeStateStatus` on many requests) the facts are computed per pull request, only for fields actually requested, and memoised per request through the existing GraphQL loaders; no persisted cache (Claude's call). Rulesets, CODEOWNERS and the base tip are loaded once per repository per request, not per pull request. Mark the per-request git work with a `ponytail:` comment naming a persisted cache as the upgrade path.

### Merging

`mergePullRequest` already judges the merge as a `pull_request_merge` write before it copies or packs anything. Add the pull request facts to that judgement.

- **No unbypassable violations and nothing bypassed:** merge as today.
- **Unbypassable violations:** refuse with `RulesetViolationError`. It lists every violation, whatever the request said.
- **Only bypassed violations:**
  - The **web app** sends an explicit flag that the user ticked the bypass checkbox. Without it, Ghost's API refuses with the list and says that a bypass is available.
  - The **GitHub compat layer** (REST `PUT /pulls/{n}/merge` and GraphQL `mergePullRequest`) merges without a flag, as GitHub does for bypass actors. Verify. `gh pr merge` itself refuses client side when `mergeStateStatus` is `BLOCKED` and tells the user to pass `--admin`. That is gh's behaviour and is accepted.
  - The merge records the bypass as a pull request timeline event that names the rulesets and rules bypassed, and an outbox event.

The flag requirement covers part A's rules too. On a merge, a bypassed `update` rule needs the checkbox like any other.

### Pushing with a bypass

When a git push succeeds because the pusher bypassed violations, print GitHub's sideband notice listing them (`Bypassed rule violations for refs/heads/main:` followed by each rule; take the exact text from a real GitHub push). Nothing extra is printed when nothing was bypassed.

### Race safety

Part A's guarantee holds. If the base ref moves after the verdict, `commitPush` fails.

There is one new race: a push to the head lands while a merge is being judged. The merge works from the head sha it loaded. Staleness and last push approval are judged against that sha, so the merge merges exactly what was judged.

## Messages

Use GitHub's wording for every requirement. Collect it from GitHub's documentation, its merge box and real API refusals; do not invent it. Expected shapes, to be verified:

- `At least N approving reviews are required by reviewers with write access.`
- `Changes must be made through a pull request.`
- code owner review: names the waiting owners;
- conversations: `All comments must be resolved.`;
- most recent push: GitHub's text for an unapproved last push;
- merge method: GitHub's text for a method not allowed.

REST `PUT /pulls/{n}/merge` answers 405 with GitHub's message for a rule-blocked merge. GraphQL `mergePullRequest` answers with GitHub's error. Ghost's own API answers 422 as in part A. Every one of these lists all the unmet requirements and names their rulesets.

## gh compatibility

- **`reviewDecision`**:
  - `CHANGES_REQUESTED` when a counting change request stands;
  - `REVIEW_REQUIRED` when the approval count or code owner review is unmet;
  - `APPROVED` when an applicable `pull_request` rule requires reviews and they are met.

  With no applicable `pull_request` rule, verify what GitHub returns and match it. The expected answer is null. If so, the current "APPROVED or CHANGES_REQUESTED without any rule" behaviour changes, and the comment on `reviewDecision` goes.
- **`mergeStateStatus`**: `BLOCKED` when the pull request is mergeable but has rule violations, including ones the viewer could bypass. GitHub shows bypass actors `BLOCKED` too, which is why gh suggests `--admin`; verify. `DRAFT` and `DIRTY` keep their current precedence.
- **REST `mergeable_state`**: `blocked` in the same cases.
- **`Ref.branchProtectionRule`**: verify on GitHub what a branch protected only by a ruleset returns.
  - If GitHub returns null, keep null and say so in the code.
  - If GitHub fills it, build it from the applicable rulesets.

  gh reads `requiresStrictStatusChecks` from it, which belongs to C.
- **`repository.rulesets`**: GitHub's `RepositoryRuleset` connection, with the fields Ghost supports, built on part A's service. Bypass actors are visible only to admins, as in REST.
- **REST rulesets:** `pull_request` is accepted in `rules` with GitHub's parameter names and validation. `rules/branches/{branch}` returns it.

## Data

Generate the migration with `bun db:generate`. Never hand-edit the SQL.

- `pull_request.head_pushed_by_id`: nullable, set null on user delete.
- `pull_request_review.base_sha`: the base tip when the review was submitted, so a base move can be detected. Reviews submitted before the migration have none; treat a null as not stale from the base side, so the migration does not dismiss every existing approval.
- Thread resolution columns, or a thread table (see Review threads).
- The bypass timeline event: follow however existing pull request timeline events are stored.
- `ruleset_rule.parameters` already exists as jsonb. The `pull_request` parameters go there, validated at the boundary.

## API

Ghost's API, under `/api/repositories/:owner/:repo`:

- the ruleset endpoints accept the `pull_request` rule and its parameters. 400 for a malformed parameter, with the same pattern as part A's status codes;
- the merge endpoint accepts the bypass flag;
- an endpoint the merge box reads for the viewer gives:
  - the violations and the bypassed violations, each naming its ruleset;
  - whether the viewer can bypass them;
  - the allowed merge methods.

  Its shape and name are the builder's call, fixed by the tests;
- thread resolve and unresolve endpoints.

## Web

- **Ruleset form:** a "Require a pull request before merging" rule with its parameters, using GitHub's labels and descriptions:
  - the approval count;
  - four checkboxes;
  - the merge methods.
- **Merge box** (`merge-panel.tsx`, `merge-button.tsx`):
  - lists every unmet requirement, each with its reason and ruleset, in the style of GitHub's merge box;
  - disables the merge button while any requirement is unmet;
  - offers only the allowed merge methods;
  - for a viewer who can bypass, shows a checkbox. The button enables only once it is ticked. Its label is **"Merge anyway, bypassing ruleset requirements"**. This is deliberately not GitHub's wording.
- **Timeline:** shows bypass events and system dismissals of stale approvals.
- **Threads:** resolve and unresolve buttons, with resolved threads collapsed.

## Testing

- **Unit, the evaluator:**
  - each `pull_request` parameter, alone and combined across several rulesets;
  - author approvals ignored;
  - write access re-checked;
  - stale approvals;
  - last push approval with each kind of pusher;
  - code owners by user and by team, and the sole owner author blocked;
  - merge method intersection, with `required_linear_history`;
  - the `violations` and `bypassed` split for `always` and `pull_request` modes;
  - missing facts fail closed.
- **Integration:**
  - the facts service against real reviews, threads and CODEOWNERS;
  - the stale-approval outbox consumer;
  - `headPushedById` set by git push and suggestion apply.
- **e2e:**
  - a direct push to a protected `main` refused with GH013 and `Changes must be made through a pull request.`;
  - a bypass push prints the bypassed notice;
  - a merge refused listing every unmet requirement;
  - a merge allowed once met;
  - a bypass merge without the flag refused, and with the flag merged and recorded;
  - thread resolve and unresolve permissions.
- **gh compat:**
  - REST 405 and `mergeable_state`;
  - GraphQL `reviewDecision`, `mergeStateStatus`, `reviewThreads`, `resolveReviewThread` and `repository.rulesets`, compared field by field with GitHub's documented responses;
  - `gh pr merge` against Ghost refusing on `BLOCKED`, using the existing gh suite.
- **Database:** run the full API suite only against a throwaway Postgres, never the dev database.

## Builder's calls

- The shape of the pull request facts and how the evaluator receives them.
- How to compare diffs for staleness.
- Thread resolution as columns or as a table.
- Name and shape of the merge box endpoint.
- Exact UI layout, within GitHub's patterns.
- How the bypass timeline event is stored.

## Still to verify against GitHub

Collect these from a real GitHub repository (the GitHub remote serves) before release:

- every message's wording;
- the push bypass notice;
- whether the `pull_request` rule touches creation and deletion;
- `reviewDecision` with no rule;
- `mergeStateStatus` for a bypass actor;
- `Ref.branchProtectionRule` for a ruleset-only branch;
- whether API merges by bypass actors need no flag;
- how a CODEOWNERS file with errors is applied;
- whether a base move dismisses approvals only when the files overlap.

## Build order

The detailed plan comes next (`superpowers:writing-plans`). Expected order, each step ending green:

1. The evaluator: the `pull_request` rule and the `bypassed` split (unit).
2. Data: `headPushedById` and thread resolution, plus the migration.
3. Thread resolution through the Ghost API and GraphQL.
4. The facts service and the stale-approval consumer.
5. Enforcement: direct push refusal, the bypass notice, merge blocking and the bypass flag.
6. gh compat fields and REST/GraphQL rulesets.
7. Web: the ruleset form, the merge box and threads.
8. Close out: verify the list above against GitHub, run the full suite against throwaway Postgres and RustFS, check the cost anti-goal by hand.
