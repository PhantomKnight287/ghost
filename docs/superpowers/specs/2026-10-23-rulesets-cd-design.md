# Repository rulesets, parts C and D: required status checks, required signatures, SSH signing keys

Issues: #89 (C), #90 (D) and #60 (SSH signing keys) on Ghost; #142 and #143 on GitHub (parent: #17 on Ghost, #62 on GitHub). This work builds on part A (`2026-10-19-rulesets-a-design.md`), part B (`2026-10-21-rulesets-b-design.md`), rule insights (`2026-10-23-rule-insights-design.md`) and commit statuses (GitHub #61). All three issues ship as one branch and one pull request.

The principle of parts A and B carries over: copy GitHub as closely as possible. Where this document is silent, do what GitHub does. Where it says "verify", check the behaviour against a real GitHub repository before release. If GitHub differs, follow GitHub and update this document.

## Intent

Parts A and B protect a ref's shape and make sure changes are reviewed. They cannot say "nothing lands on `main` until CI passed on it" or "every commit on `main` is signed by someone Ghost can vouch for". C and D add GitHub's `required_status_checks` and `required_signatures` rules, which do.

Nothing posts statuses to Ghost yet apart from the user's own scripts. C still has to work for the CI and bots that come later. GitHub lets a check be pinned to the app that must post it (`integration_id`), but that id names a GitHub App, and Ghost has no equivalent until Ghost Apps (#50). OAuth apps cannot stand in: every OAuth grant mints an ordinary user API key tagged with the app, and the device flow hands such a key to any user who knows the app's public `client_id`. So C ships with context-only checks, and `integration_id` waits for #50 (user decision, 2026-10-23; recorded on #50). Until then, anyone with write access can post a `success` for a required context, as on GitHub for an unpinned check.

Many people now sign with SSH keys (`gpg.format=ssh`). Without SSH verification, D would refuse their commits, so SSH signing keys (#60) ship in this slice.

Both rules apply at the same two moments, as the user decided:

- a direct `git push` to a targeted ref is refused, with GH013 as in part A;
- the merge button stays disabled on a pull request into a targeted ref, and every merge API refuses.

## Goals

1. The `required_status_checks` rule with GitHub's parameters:
   - `required_status_checks`: a list of `{ context }`. `integration_id` is refused until #50;
   - `strict_required_status_checks_policy`;
   - `do_not_enforce_on_create`.
2. The `required_signatures` rule (no parameters).
3. A rule that sets `integration_id` is refused with 422 and a message saying app-pinned checks need Ghost Apps.
4. SSH signing keys: kept apart from authentication keys, managed in settings and through GitHub's REST API. Commits signed with them verify like GPG-signed commits do.
5. Both rules take part in everything parts A, B and rule insights built: bypass, `evaluate` enforcement, rule suites, the merge box, the merge-requirements endpoint and the gh compat fields.
6. The ruleset form offers status check contexts as free text, with suggestions from the contexts this repository has already seen.

## Non-goals

- App-pinned checks (`integration_id`) and recording which app posted a status. Both wait for Ghost Apps (#50).
- The checks API (check runs and check suites). Ghost has commit statuses only, so only statuses satisfy a required check.
- "Update branch". It remains its own issue, as in part B. With strict mode on, a pull request that is behind must be updated by pushing.
- Verifying signatures on tags, and showing tag verification. Ghost shows no tag verification today, even for GPG. This narrows #60's "commits and tags" to commits; tags are tracked as Ghost #100.
- Merge queues, auto-merge and organization rulesets (unchanged).
- Classic branch protection's REST API (unchanged).

## Anti-goals

- **Pretending to pin a check.** An `integration_id` that is silently stored but not enforced. It is refused instead.
- **A signed merge requirement that Ghost's own merges cannot meet.** Ghost's merges are judged by the same rule. A ruleset with `required_signatures` cannot be saved while Ghost has no signing key, so this cannot arise in normal use.
- **Cost on repositories that do not use these rules.** With no active or evaluate ruleset carrying C or D on the ref, pushes and merges run no extra git command and no extra query, beyond part A's single ruleset query.
- **Verifying the same commit twice in one push.** Each commit a push adds is verified once, however many refs reach it.
- **Showing only the first unmet requirement.** As in part B, every surface lists all of them.

## `required_status_checks`

### Parameters

| Parameter | Type | Meaning |
|---|---|---|
| `required_status_checks` | array of `{ context: string }` | contexts that must report `success` |
| `strict_required_status_checks_policy` | boolean | the pull request's head must contain the base tip |
| `do_not_enforce_on_create` | boolean | creating a targeted ref skips the rule |

Take the defaults, the validation messages and the required keys from GitHub's REST schema for repository rulesets. An empty list is allowed if GitHub allows it (verify).

### When a check is satisfied

A required check `{ context }` is satisfied on a commit when the latest status for `context` on that commit is `success`. This matches `combinedState`'s notion of the latest status per context.

Only statuses posted to the base repository count. A status on the fork of a cross-repository pull request never satisfies the base's rule, because the fork's owner can post anything there (Claude's call). The pull request rollup may keep merging fork statuses for display, but the C facts, `isRequired` and the merge box's required rows read the base repository only.

`pending`, `failure`, `error` and a missing status all leave the check unmet. The violation lists every unmet context with its current state, or "expected" when no status exists.

### Several rulesets

As in parts A and B, everything adds up:

- the required contexts are the union of every applicable rule's contexts.;
- strict is on if any applicable rule turns it on;
- `do_not_enforce_on_create` applies per rule. A rule without it still refuses the create.

### Which commit is judged

- **Push:** the new tip of each targeted ref. A commit that CI already passed elsewhere, for example on a feature branch, may be pushed directly. A fresh commit never can, because it has no statuses yet. Deletions are not judged.
- **Push, strict:** an update that is not a fast-forward is already refused by `non_fast_forward` if it is configured. Strict adds nothing on a push (verify).
- **Pull request merge:** the pull request's head commit, the same sha the merge works from (part B's race rule). The merge commit Ghost creates is not judged.
- **Pull request merge, strict:** the base tip must be an ancestor of the head. Otherwise the requirement `strict` is unmet ("This branch is out-of-date with the base branch", verify the wording).

## `required_signatures`

### When a write is satisfied

Every commit the write adds to the ref must be verified, meaning `CommitVerificationService` reports `verified: true`. Unsigned commits, unknown keys, keys not linked to the commit's author email, and bad signatures all fail. The violation lists each failing commit (short sha) with its reason, up to a limit chosen by the builder, then a count of the rest.

"Commits the write adds" means:

- **Update:** commits reachable from the new tip and not from the old tip.
- **Create:** commits reachable from the new tip and not from any existing ref outside `refs/pull/*`, matching how `refFacts` judges a create.
- **Merge, `merge` method:** the pull request's commits (as above, against the base tip) plus the merge commit Ghost writes.
- **Merge, `squash` method:** the one commit Ghost writes.
- **Merge, `rebase` method:** the commits Ghost writes.

Ghost signs the commits it writes when `COMMIT_SIGNING_KEY` is set, and they verify as platform-signed. Without the key they are unsigned. So saving a ruleset (create or update, any enforcement) that contains `required_signatures` is refused while `COMMIT_SIGNING_KEY` is unset: 422 on GitHub REST, 400 on Ghost's API, with the message "Required signatures need a commit signing key on this server" (user decision, 2026-10-23). The web app shows nothing in advance; it shows the error when the save fails. If the key is removed after such a ruleset exists, Ghost-written commits fail verification like any unsigned commit, and the merge is refused through the ordinary rule. Nothing special-cases this.

This one rule replaces method-specific special cases. Verify against GitHub:

- whether a `merge`-method merge with unsigned pull request commits is refused (expected: yes);
- whether `squash` with unsigned pull request commits is allowed (expected: yes);
- whether `rebase` merge is allowed (GitHub historically refused it under required signatures). If GitHub refuses rebase, Ghost follows and removes `rebase` from the allowed methods, as `required_linear_history` removes `merge`.

### Where verification runs

- **Push:** inside `withVerifiedPack`'s quarantine, next to `refFacts`, using `verifyCommits` with the quarantine `env`. It runs only for refs a C/D rule targets, and only for D. Deduplicate commits across refs.
- **Merge:** in the pull request facts service from part B, only when a D rule applies.

Mark the per-push verification with a `ponytail:` comment naming its ceiling: the cost is linear in the commits a push adds, so a first push of a large history to a protected new branch verifies all of it. The upgrade path is caching verdicts by sha and key set.

## SSH signing keys (#60)

- **Data:** a `user_ssh_signing_key` table with id, user, title, fingerprint, public key and timestamps. Fingerprints are unique per table, not across tables, so one key can be both an authentication key and a signing key, as on GitHub. Adding a signing key never grants git access over SSH.
- **Settings:** a "Signing keys" section beside SSH keys in the user's settings, as on GitHub's SSH and GPG keys page, with add and delete.
- **GitHub REST:** `GET`/`POST /user/ssh_signing_keys` and `GET`/`DELETE /user/ssh_signing_keys/:id` with GitHub's shapes, scopes and errors. Then `gh ssh-key add --type signing` and `gh ssh-key list` work. Remove the entry from `UNSERVED` in `apps/api/src/github/gh-capture.spec.ts`.
- **Verification:** `readSignedCommits` stops skipping `-----BEGIN SSH SIGNATURE-----`. `CommitVerificationService.judge` verifies an `sshsig` signature with namespace `git` against the signing keys and verified emails of the user who owns the commit's author email. This is the same identity GPG verification already matches, so badges stay consistent. Whether GitHub matches the author or the committer is on the verify list; if it is the committer, switch GPG and SSH together in a follow-up rather than in this slice (Claude's call). It uses the same states and reasons as GPG, with the key identified by fingerprint instead of key id. The library or `ssh-keygen -Y verify` is the builder's call. A signature with any namespace other than `git` fails.
- **Docs:** under `apps/docs/content/docs/signing/`, pages on adding an SSH signing key and telling git to use it, alongside the GPG pages.

## Enforcement

### The evaluator

`evaluateRulesets` stays pure and gains the two rule types. The facts it needs are the builder's call, but they must cover:

- **C:** for each judged commit, its latest status per context, and for merges, whether the base tip is an ancestor of the head;
- **D:** for each judged ref or merge, the commits it adds that are not verified, each with its reason, and whether Ghost can sign.

Missing facts break the rule (fail closed), as in parts A and B. The `violations` / `bypassed` split, `evaluate` enforcement and rule suite recording all work as before. The new requirement names (for example `status_checks`, `strict`, `signatures`) join `REQUIREMENTS`, fixed by the tests.

### Pushes

`ruleset-verdicts.service` computes C facts (one statuses query for all judged tips) and D facts (in quarantine) only for refs a C or D rule targets. Refusals use GH013 and list every violation, as in part A. Bypass prints part B's notice.

### Ghost's other ref writes

Part A also judges Ghost's own API writes as `push` writes: creating and deleting branches, applying a suggestion, and creating and deleting release tags. C and D apply to them, as GitHub applies its rules to web commits (Claude's call; verify the suggestion case). These writes add no unseen objects, so their facts are computed against the repository itself, without a quarantine:

- **C:** the statuses of the new tip. A branch created at a commit CI already passed is allowed. An applied suggestion is a brand-new commit with no statuses, so it is refused on a head branch with required checks, unless the user bypasses.
- **D:** a create at existing history adds no commits and passes. An applied suggestion is signed by Ghost, so it passes when `COMMIT_SIGNING_KEY` is set and is refused when it is not.

Whether C and D may target tags follows GitHub's list of rules available to tag rulesets (verify). Where GitHub refuses a rule for a tag target, the ruleset endpoints refuse it with GitHub's error.

### Merges

Part B's pull request facts service gains C and D facts, so the merge, the merge box, `mergeStateStatus`, `mergeable_state` and the merge-requirements endpoint all agree.

## gh compatibility

- **`mergeStateStatus`:** `BEHIND` when strict is unmet and nothing else blocks. `BLOCKED` when a required check is unmet or failing, or signatures are unmet. `UNSTABLE` when a non-required status is failing and nothing required is unmet. Follow GitHub's precedence (verify), keeping `DRAFT` and `DIRTY` as now. REST `mergeable_state` follows (`behind`, `blocked`, `unstable`).
- **`statusCheckRollup` and `StatusContext.isRequired(pullRequestNumber:)`:** `isRequired` is true for contexts a C rule requires on the pull request's base. `gh pr checks --required` filters on it.
- **`Ref.branchProtectionRule`:** stays null for ruleset-only branches, as observed in part B. `requiresStrictStatusChecks` is therefore not served from rulesets.
- **REST and GraphQL rulesets:** accept and return both rule types with GitHub's parameter names. `rules/branches/{branch}` returns them. GraphQL `RequiredStatusChecksParameters` follows GitHub's schema.

## Data

Generate migrations with `bun db:generate`. Never hand-edit the SQL.

- Rule enum values `required_status_checks` and `required_signatures`.
- `user_ssh_signing_key`.
- Parameters go in `ruleset_rule.parameters` (jsonb), validated at the boundary with a zod schema, like `PullRequestRuleParametersZodSchema`.

## API

Under `/api/repositories/:owner/:repo`:

- the ruleset endpoints accept both rules, with 400 for malformed parameters as in parts A and B;
- an endpoint returns status check context suggestions: the distinct contexts of this repository's statuses, newest first, at most 50, with no time window (Claude's call);
- the merge-requirements endpoint reports C and D requirements with their details;
- user endpoints list, add and delete SSH signing keys.

## Web

- **Ruleset form:** use GitHub's labels for both rules.
  - "Require status checks to pass": a "Require branches to be up to date before merging" checkbox, a "Do not require status checks on creation" checkbox, and a list of contexts. Each context is added by typing freely or by picking a suggestion. There is no source picker until #50.
  - "Require signed commits": no parameters.
- **Merge box:** a checks section listing each required context with its state and a "Required" badge, plus non-required statuses below, as GitHub does. "This branch is out-of-date" when strict is unmet. Unverified commits are listed when signatures are unmet. Bypass works as in part B.
- **User settings:** the signing keys section.
- **Rule insights:** C and D evaluations show with their details. This needs no new UI if part B's rendering covers it.

## Testing

Red tests come first, following the workflow for this feature.

- **Unit, the evaluator:**
  - each C parameter alone and combined across rulesets;
  - `integration_id` refused;
  - latest-status selection;
  - strict;
  - `do_not_enforce_on_create`;
  - saving `required_signatures` refused without a signing key;
  - D with verified, unsigned, unknown-key and wrong-email commits (matched to the author email, as GPG verification does today), and each merge method with and without a signing key;
  - bypass and evaluate for both rules;
  - missing facts fail closed.
- **Unit, SSH verification:** `sshsig` against the signer's key with namespace `git`; a wrong namespace; an unknown key; a key on another user; an unverified email; ed25519 and RSA.
- **Integration:**
  - D facts computed in quarantine for a create and an update;
  - commits deduplicated across refs;
- **e2e:**
  - a push of a commit without the required status refused, and the same sha accepted once a `success` status exists;
  - an unsigned push refused, and a GPG-signed and an SSH-signed push accepted;
  - a merge blocked while checks are pending, while behind under strict, and while commits are unsigned;
  - each blocked merge allowed once met;
  - squash with unsigned commits allowed when Ghost signs;
  - the signing-key REST endpoints.
- **gh:**
  - `gh ssh-key add --type signing` and `gh ssh-key list`;
  - `gh pr checks --required`;
  - `gh pr merge` refusing on `BLOCKED` and `BEHIND`;
  - captured fixtures updated.
- **Database:** run the full API suite only against a throwaway Postgres, never the dev database.

## Builder's calls

- The fact shapes and how the evaluator receives them.
- `ssh-keygen -Y verify` or a library for `sshsig`.
- How many failing commits a D violation lists before summarising.
- The suggestions endpoint's name and shape.
- Exact UI layout, within GitHub's patterns.

## Still to verify against GitHub

- Every message's wording: unmet and expected checks, behind, unsigned commits.
- Whether an empty `required_status_checks` list is accepted.
- Strict's effect on pushes.
- How each merge method behaves under required signatures, rebase especially.
- `mergeStateStatus` precedence among `BEHIND`, `BLOCKED` and `UNSTABLE`.
- Whether signature verification matches the author's or the committer's email.
- Whether applying a suggestion on a branch with required checks is refused.
- Which of C and D tag rulesets accept.

## Build order

The detailed plan comes next (`superpowers:writing-plans`). Each step ends green.

1. Data: enum values, `user_ssh_signing_key`, migration.
2. SSH signing keys: the API, GitHub REST, verification in `CommitVerificationService`.
3. The evaluator: both rules (unit).
4. Facts: push (statuses query, quarantine verification) and merge (the part B facts service).
5. Enforcement end to end: push refusal, merge blocking, bypass, rule suites.
6. gh compat: `mergeStateStatus`, `isRequired`, rulesets, statuses.
7. Web: ruleset form with suggestions, merge box, signing keys settings.
8. Docs: SSH signing pages and rule documentation.
9. Close out: verify the list above against GitHub, run the full suite against throwaway Postgres and RustFS, and check the cost anti-goal by hand.
