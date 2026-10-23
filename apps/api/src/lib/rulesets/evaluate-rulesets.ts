import { atLeast } from '@ghost/permissions';

import { type RefTransition, ZERO_OID } from '../git/wal/wal.types.js';
import { refTargeted } from './ref-pattern.js';
import type {
  BypassAnswer,
  MergeMethod,
  PullRequestFacts,
  PullRequestRuleParameters,
  RefFacts,
  Requirement,
  Ruleset,
  RulesetActor,
  RuleEvaluation,
  RulesetEvaluation,
  RuleSuiteResult,
  RuleType,
  StatusCheckRuleParameters,
  Violation,
} from './rulesets.types.js';

type RefRule = Exclude<
  RuleType,
  'pull_request' | 'required_status_checks' | 'required_signatures'
>;

const MESSAGES: Record<RefRule, string> = {
  creation: 'Cannot create ref due to creations being restricted',
  update: 'Cannot update this protected ref',
  deletion: 'Cannot delete this protected ref',
  non_fast_forward: 'Cannot force-push to this branch',
  required_linear_history: 'This branch must not contain merge commits',
};

const MERGE_METHODS: MergeMethod[] = ['merge', 'squash', 'rebase'];

// GitHub's 405 wording for a method a rule leaves out.
const METHOD_NAMES: Record<MergeMethod, string> = {
  merge: 'Merge commits',
  squash: 'Squash merges',
  rebase: 'Rebase merges',
};

/** How far `actor` may skip `ruleset`: GitHub's `current_user_can_bypass`. */
export function bypassOf(
  ruleset: Pick<Ruleset, 'bypassActors'>,
  actor: RulesetActor,
): BypassAnswer {
  const modes = ruleset.bypassActors
    .filter(
      (bypass) =>
        (bypass.actorType === 'RepositoryRole' &&
          atLeast(actor.role, bypass.role)) ||
        (bypass.actorType === 'Team' &&
          actor.teamIds.includes(bypass.teamId)) ||
        (bypass.actorType === 'OrganizationAdmin' && actor.organizationAdmin),
    )
    .map(({ bypassMode }) => bypassMode);
  if (modes.includes('always')) return 'always';
  return modes.length > 0 ? 'pull_requests_only' : 'never';
}

/** What a merge leaves unmet under one `pull_request` rule, as [requirement, message] pairs. */
function unmetOnMerge(
  parameters: PullRequestRuleParameters,
  pullRequest: PullRequestFacts | undefined,
): [Requirement, string][] {
  // Missing facts count against the merge, as missing ref facts do.
  if (!pullRequest)
    return [['pull_request', 'Pull request requirements could not be checked']];
  const unmet: [Requirement, string][] = [];
  const counted = parameters.dismiss_stale_reviews_on_push
    ? pullRequest.approvals.filter(({ stale }) => !stale)
    : pullRequest.approvals;
  const required = parameters.required_approving_review_count;

  if (counted.length < required)
    unmet.push([
      'approvals',
      `At least ${required} approving review${required === 1 ? ' is' : 's are'} required by reviewers with write access.`,
    ]);
  // GitHub: whoever requests changes must approve before the pull request can merge, whatever the approval count.
  if (pullRequest.changesRequestedBy.length > 0)
    unmet.push([
      'changes_requested',
      'Changes requested by reviewers with write access.',
    ]);
  if (parameters.require_code_owner_review) {
    // An author who owns a path stands in for its owners, as GitHub lets a sole owner's own pull request merge.
    const waiting = pullRequest.codeOwners.filter(
      (owned) =>
        !owned.userIds.includes(pullRequest.authorId) &&
        !counted.some(
          (approval) =>
            owned.userIds.includes(approval.userId) ||
            approval.teamIds.some((teamId) => owned.teamIds.includes(teamId)),
        ),
    );
    if (waiting.length > 0)
      unmet.push([
        'code_owners',
        `Waiting on code owner review from ${[...new Set(waiting.flatMap(({ tokens }) => tokens))].join(', ')}.`,
      ]);
  }
  // Staleness counts here whatever dismiss_stale says: an approval of an older push is not an approval of the last one.
  if (
    parameters.require_last_push_approval &&
    !pullRequest.approvals.some(
      ({ userId, stale }) =>
        !stale &&
        pullRequest.headPushedById !== null &&
        userId !== pullRequest.headPushedById,
    )
  )
    unmet.push([
      'last_push',
      'New changes require approval from someone other than the last pusher.',
    ]);
  if (
    parameters.required_review_thread_resolution &&
    pullRequest.unresolvedThreads > 0
  )
    unmet.push([
      'threads',
      'A conversation must be resolved before this pull request can be merged.',
    ]);
  if (!parameters.allowed_merge_methods.includes(pullRequest.method))
    unmet.push([
      'merge_method',
      `${METHOD_NAMES[pullRequest.method]} are not allowed on this repository.`,
    ]);
  return unmet;
}

/** The required contexts a status check rule leaves unmet, then whether a merge is behind under strict. Missing statuses count against the write. */
function unmetChecks(
  parameters: StatusCheckRuleParameters,
  facts: RefFacts | undefined,
  merging: boolean,
): [Requirement, string][] {
  const unmet: [Requirement, string][] = [];
  for (const { context } of parameters.required_status_checks) {
    const state = facts?.statuses?.find(
      (status) => status.context === context,
    )?.state;
    if (state !== 'success')
      unmet.push([
        'status_checks',
        `Required status check "${context}" is ${state ?? 'expected'}.`,
      ]);
  }
  if (
    merging &&
    parameters.strict_required_status_checks_policy &&
    facts?.upToDate !== true
  )
    unmet.push([
      'up_to_date',
      'This branch is out-of-date with the base branch.',
    ]);
  return unmet;
}

const LISTED_COMMITS = 10;

/** Every commit the write adds that does not verify, as one requirement. Missing facts count against the write. */
function unmetSignatures(facts: RefFacts | undefined): [Requirement, string][] {
  const commits = facts?.unverifiedCommits;
  if (commits?.length === 0) return [];
  if (!commits)
    return [['signatures', 'Commits must have verified signatures.']];
  const listed = commits
    .slice(0, LISTED_COMMITS)
    .map(({ sha, reason }) => `${sha.slice(0, 7)} ${reason}`);
  if (commits.length > LISTED_COMMITS)
    listed.push(`and ${commits.length - LISTED_COMMITS} more`);
  return [
    [
      'signatures',
      ['Commits must have verified signatures.', ...listed].join('\n'),
    ],
  ];
}

/** Every rule each write breaks. What the actor may bypass for this write goes to `bypassed`, the rest to `violations`, which refuse it. Evaluate rulesets refuse nothing: they only show in `suites`, which list every rule checked per ref. */
export function evaluateRulesets(payload: {
  rulesets: Ruleset[];
  actor: RulesetActor;
  write: 'push' | 'pull_request_merge';
  transitions: RefTransition[];
  facts: Map<string, RefFacts>;
  defaultBranch: string;
  pullRequest?: PullRequestFacts;
}): RulesetEvaluation {
  const violations: Violation[] = [];
  const bypassed: Violation[] = [];
  const tallies = new Map<
    string,
    {
      evaluations: RuleEvaluation[];
      refused: boolean;
      bypassed: boolean;
      evaluated: boolean;
      evaluateFailed: boolean;
    }
  >();
  for (const ruleset of payload.rulesets) {
    if (ruleset.enforcement === 'disabled') continue;
    const active = ruleset.enforcement === 'active';
    const bypass = bypassOf(ruleset, payload.actor);
    const bypassable =
      bypass === 'always' ||
      (bypass === 'pull_requests_only' &&
        payload.write === 'pull_request_merge');

    for (const { ref, oldOid, newOid } of payload.transitions) {
      if (!refTargeted(ruleset, ref, payload.defaultBranch)) continue;
      const created = oldOid.equals(ZERO_OID);
      const deleted = newOid.equals(ZERO_OID);
      const updated = !created && !deleted;
      // Missing facts count against the write: a caller that forgot to compute them must not slip past the rule.
      const facts = payload.facts.get(ref);
      const broken: Record<RefRule, boolean> = {
        creation: created,
        update: updated,
        deletion: deleted,
        non_fast_forward: updated && facts?.isFastForward !== true,
        required_linear_history:
          !deleted && facts?.introducesMergeCommit !== false,
      };
      const tally = tallies.get(ref) ?? {
        evaluations: [],
        refused: false,
        bypassed: false,
        evaluated: false,
        evaluateFailed: false,
      };
      tallies.set(ref, tally);
      tally.evaluated ||= !active;
      const named = { ref, rulesetId: ruleset.id, rulesetName: ruleset.name };
      for (const rule of ruleset.rules) {
        // Creating and deleting are the creation and deletion rules' business, so the pull_request rule only weighs an update.
        const unmet: [Requirement | undefined, string][] =
          rule.type === 'required_status_checks'
            ? deleted ||
              (created &&
                (rule.parameters as StatusCheckRuleParameters)
                  .do_not_enforce_on_create)
              ? []
              : unmetChecks(
                  rule.parameters as StatusCheckRuleParameters,
                  facts,
                  payload.write === 'pull_request_merge',
                )
            : rule.type === 'required_signatures'
              ? deleted
                ? []
                : unmetSignatures(facts)
              : rule.type !== 'pull_request'
                ? broken[rule.type]
                  ? [[undefined, MESSAGES[rule.type]]]
                  : []
                : !updated
                  ? []
                  : payload.write === 'push'
                    ? [
                        [
                          'pull_request',
                          'Changes must be made through a pull request.',
                        ],
                      ]
                    : unmetOnMerge(
                        rule.parameters as PullRequestRuleParameters,
                        payload.pullRequest,
                      );
        tally.evaluations.push({
          rulesetId: ruleset.id,
          rulesetName: ruleset.name,
          enforcement: ruleset.enforcement,
          rule: rule.type,
          result: unmet.length > 0 ? 'fail' : 'pass',
          requirements: unmet.flatMap(([requirement]) =>
            requirement ? [requirement] : [],
          ),
          details:
            unmet.length > 0
              ? unmet.map(([, message]) => message).join('\n')
              : null,
        });
        if (unmet.length === 0) continue;
        if (!active) {
          tally.evaluateFailed = true;
          continue;
        }
        tally.bypassed ||= bypassable;
        tally.refused ||= !bypassable;
        for (const [requirement, message] of unmet)
          (bypassable ? bypassed : violations).push({
            ...named,
            rule: rule.type,
            ...(requirement && { requirement }),
            message,
          });
      }
    }
  }

  const suites = payload.transitions.flatMap((transition) => {
    const tally = tallies.get(transition.ref);
    if (!tally || tally.evaluations.length === 0) return [];
    const result: RuleSuiteResult = tally.refused
      ? 'fail'
      : tally.bypassed
        ? 'bypass'
        : 'pass';
    return [
      {
        transition,
        result,
        evaluationResult: !tally.evaluated
          ? null
          : tally.evaluateFailed
            ? ('fail' as const)
            : result,
        evaluations: tally.evaluations,
      },
    ];
  });
  return { violations, bypassed, suites };
}

/** The merge methods every applicable ruleset allows, after `required_linear_history` removes `merge`. */
export function allowedMergeMethods(
  rulesets: Ruleset[],
  ref: string,
  defaultBranch: string,
): MergeMethod[] {
  let allowed = MERGE_METHODS;
  for (const ruleset of rulesets) {
    if (ruleset.enforcement !== 'active') continue;
    if (!refTargeted(ruleset, ref, defaultBranch)) continue;
    for (const rule of ruleset.rules) {
      if (rule.type === 'required_linear_history')
        allowed = allowed.filter((method) => method !== 'merge');
      if (rule.type === 'pull_request') {
        const { allowed_merge_methods } =
          rule.parameters as PullRequestRuleParameters;
        allowed = allowed.filter((method) =>
          allowed_merge_methods.includes(method),
        );
      }
    }
  }
  return allowed;
}

/** The contexts active rulesets require on `ref`, sorted: what GitHub's `isRequired` and the merge box mark as required. */
export function requiredContexts(
  rulesets: Ruleset[],
  ref: string,
  defaultBranch: string,
): string[] {
  const contexts = new Set<string>();
  for (const ruleset of rulesets) {
    if (ruleset.enforcement !== 'active') continue;
    if (!refTargeted(ruleset, ref, defaultBranch)) continue;
    for (const rule of ruleset.rules)
      if (rule.type === 'required_status_checks')
        for (const { context } of (rule.parameters as StatusCheckRuleParameters)
          .required_status_checks)
          contexts.add(context);
  }
  return [...contexts].sort();
}
