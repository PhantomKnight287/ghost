import { atLeast } from '@ghost/permissions';

import { type RefTransition, ZERO_OID } from '../git/wal/wal.types.js';
import { refTargeted } from './ref-pattern.js';
import type {
  BypassAnswer,
  RefFacts,
  RuleType,
  Ruleset,
  RulesetActor,
  Violation,
} from './rulesets.types.js';

const MESSAGES: Record<RuleType, string> = {
  creation: 'Cannot create ref due to creations being restricted',
  update: 'Cannot update this protected ref',
  deletion: 'Cannot delete this protected ref',
  non_fast_forward: 'Cannot force-push to this branch',
  required_linear_history: 'This branch must not contain merge commits',
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

export function evaluateRulesets(payload: {
  rulesets: Ruleset[];
  actor: RulesetActor;
  write: 'push' | 'pull_request_merge';
  transitions: RefTransition[];
  facts: Map<string, RefFacts>;
  defaultBranch: string;
}): Violation[] {
  const violations: Violation[] = [];
  for (const ruleset of payload.rulesets) {
    if (ruleset.enforcement !== 'active') continue;
    const bypass = bypassOf(ruleset, payload.actor);
    if (
      bypass === 'always' ||
      (bypass === 'pull_requests_only' &&
        payload.write === 'pull_request_merge')
    )
      continue;

    for (const { ref, oldOid, newOid } of payload.transitions) {
      if (!refTargeted(ruleset, ref, payload.defaultBranch)) continue;
      const created = oldOid.equals(ZERO_OID);
      const deleted = newOid.equals(ZERO_OID);
      const updated = !created && !deleted;
      // Missing facts count against the write: a caller that forgot to compute them must not slip past the rule.
      const facts = payload.facts.get(ref);
      const broken: Record<RuleType, boolean> = {
        creation: created,
        update: updated,
        deletion: deleted,
        non_fast_forward: updated && facts?.isFastForward !== true,
        required_linear_history:
          !deleted && facts?.introducesMergeCommit !== false,
      };
      for (const { type } of ruleset.rules) {
        if (!broken[type]) continue;
        violations.push({
          ref,
          rulesetId: ruleset.id,
          rulesetName: ruleset.name,
          rule: type,
          message: MESSAGES[type],
        });
      }
    }
  }
  return violations;
}
