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
  RulesetEvaluation,
  RuleType,
  Violation,
} from './rulesets.types.js';

const MESSAGES: Record<Exclude<RuleType, 'pull_request'>, string> = {
  creation: 'Cannot create ref due to creations being restricted',
  update: 'Cannot update this protected ref',
  deletion: 'Cannot delete this protected ref',
  non_fast_forward: 'Cannot force-push to this branch',
  required_linear_history: 'This branch must not contain merge commits',
};

const MERGE_METHODS: MergeMethod[] = ['merge', 'squash', 'rebase'];

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
  // ponytail: a change request blocks only when reviews are required at all; Task 9 checks GitHub with a count of 0.
  if (
    pullRequest.changesRequestedBy.length > 0 &&
    (required > 0 || parameters.require_code_owner_review)
  )
    unmet.push([
      'changes_requested',
      'Changes requested by reviewers with write access.',
    ]);
  if (parameters.require_code_owner_review) {
    const waiting = pullRequest.codeOwners.filter(
      (owned) =>
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
      'The most recent push must be approved by someone other than the last pusher.',
    ]);
  if (
    parameters.required_review_thread_resolution &&
    pullRequest.unresolvedThreads > 0
  )
    unmet.push(['threads', 'All comments must be resolved.']);
  if (!parameters.allowed_merge_methods.includes(pullRequest.method))
    unmet.push([
      'merge_method',
      `Merge method ${pullRequest.method} is not allowed.`,
    ]);
  return unmet;
}

/** Every rule each write breaks. What the actor may bypass for this write goes to `bypassed`, the rest to `violations`, which refuse it. */
export function evaluateRulesets(payload: {
  rulesets: Ruleset[];
  actor: RulesetActor;
  write: 'push' | 'pull_request_merge';
  transitions: RefTransition[];
  facts: Map<string, RefFacts>;
  defaultBranch: string;
  pullRequest?: PullRequestFacts;
}): RulesetEvaluation {
  const evaluation: RulesetEvaluation = { violations: [], bypassed: [] };
  for (const ruleset of payload.rulesets) {
    if (ruleset.enforcement !== 'active') continue;
    const bypass = bypassOf(ruleset, payload.actor);
    const into =
      bypass === 'always' ||
      (bypass === 'pull_requests_only' &&
        payload.write === 'pull_request_merge')
        ? evaluation.bypassed
        : evaluation.violations;

    for (const { ref, oldOid, newOid } of payload.transitions) {
      if (!refTargeted(ruleset, ref, payload.defaultBranch)) continue;
      const created = oldOid.equals(ZERO_OID);
      const deleted = newOid.equals(ZERO_OID);
      const updated = !created && !deleted;
      // Missing facts count against the write: a caller that forgot to compute them must not slip past the rule.
      const facts = payload.facts.get(ref);
      const broken: Record<Exclude<RuleType, 'pull_request'>, boolean> = {
        creation: created,
        update: updated,
        deletion: deleted,
        non_fast_forward: updated && facts?.isFastForward !== true,
        required_linear_history:
          !deleted && facts?.introducesMergeCommit !== false,
      };
      const named = { ref, rulesetId: ruleset.id, rulesetName: ruleset.name };
      for (const rule of ruleset.rules) {
        if (rule.type !== 'pull_request') {
          if (broken[rule.type])
            into.push({
              ...named,
              rule: rule.type,
              message: MESSAGES[rule.type],
            });
          continue;
        }
        // Creating and deleting are the creation and deletion rules' business.
        if (!updated) continue;
        const unmet: [Requirement, string][] =
          payload.write === 'push'
            ? [['pull_request', 'Changes must be made through a pull request.']]
            : unmetOnMerge(
                rule.parameters as PullRequestRuleParameters,
                payload.pullRequest,
              );
        for (const [requirement, message] of unmet)
          into.push({ ...named, rule: 'pull_request', requirement, message });
      }
    }
  }
  return evaluation;
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
