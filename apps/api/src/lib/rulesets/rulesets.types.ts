import { schema } from '@ghost/db';
import { Role } from '@ghost/permissions';
import { z } from 'zod';

import type { RefTransition } from '../git/wal/wal.types.js';

export type RuleType = (typeof schema.rulesetRuleType.enumValues)[number];

export type Ruleset = {
  id: string;
  name: string;
  target: (typeof schema.rulesetTarget.enumValues)[number];
  enforcement: (typeof schema.rulesetEnforcement.enumValues)[number];
  include: string[];
  exclude: string[];
  bypassActors: BypassActor[];
  rules: { type: RuleType; parameters?: Record<string, unknown> }[];
};

export type BypassActor = {
  bypassMode: (typeof schema.rulesetBypassMode.enumValues)[number];
} & (
  | {
      actorType: 'RepositoryRole';
      role: 'write' | 'maintain' | 'admin';
    }
  | {
      actorType: 'Team';
      teamId: string;
    }
  | {
      actorType: 'OrganizationAdmin';
    }
);

export type RulesetActor = {
  role: Role | null;
  teamIds: string[];
  organizationAdmin: boolean;
};

export type RefFacts = {
  isFastForward: boolean;
  introducesMergeCommit: boolean;
};

/** The facts of a create that points a ref at history the repository already holds, as API writes do: nothing it reaches is new. */
export const EXISTING_HISTORY: RefFacts = {
  isFastForward: true,
  introducesMergeCommit: false,
};

export type Violation = {
  ref: string;
  rulesetId: string;
  rulesetName: string;
  rule: RuleType;
  requirement?: Requirement;
  message: string;
};

export type BypassAnswer = 'always' | 'pull_requests_only' | 'never';

/** What the rulesets decided about a write, for exactly these transitions. */
export type RulesetVerdict = {
  transitions: RefTransition[];
  violations: Violation[];
  bypassed: Violation[];
};

/**
 * Who moves refs in a `commitPush`. A user write carries the verdict for its exact transitions; a push whose transport named no user is judged as someone who bypasses nothing. `'system'` skips rulesets and is for these callers only:
 * - repository-repair.service: repairs replay history already in the log.
 * - pull-refs.service: `refs/pull/*` is never user-protected.
 * - repositories.service, initialising a repository: no ruleset can exist yet.
 */
export type RefWriter =
  | { userId: string | null; verdict: RulesetVerdict }
  | 'system';

export const MergeMethodZodSchema = z.enum(['merge', 'squash', 'rebase']);
export type MergeMethod = z.infer<typeof MergeMethodZodSchema>;

/** GitHub's REST schema for the `pull_request` rule's parameters, with its defaults. Unknown keys, GitHub's preview parameters among them, are refused. */
export const PullRequestRuleParametersZodSchema = z.strictObject({
  required_approving_review_count: z
    .int({ error: 'required_approving_review_count must be an integer' })
    .min(0, { error: 'Minimum required_approving_review_count is 0' })
    .max(10, { error: 'Maximum required_approving_review_count is 10' })
    .default(0),
  dismiss_stale_reviews_on_push: z
    .boolean({
      error: 'dismiss_stale_reviews_on_push must be a boolean',
    })
    .default(false),
  require_code_owner_review: z
    .boolean({
      error: 'require_code_owner_review must be a boolean',
    })
    .default(false),
  require_last_push_approval: z
    .boolean({
      error: 'require_last_push_approval must be a boolean',
    })
    .default(false),
  required_review_thread_resolution: z
    .boolean({
      error: 'required_review_thread_resolution must be a boolean',
    })
    .default(false),
  allowed_merge_methods: z
    .array(MergeMethodZodSchema, {
      error: 'allowed_merge_methods must be one of the given values',
    })
    .min(1, { error: 'allowed_merge_methods must name at least one method' })
    .refine((methods) => new Set(methods).size === methods.length, {
      error: 'allowed_merge_methods must not name a method twice',
    })
    .default(['merge', 'squash', 'rebase']),
});

export type PullRequestRuleParameters = z.infer<
  typeof PullRequestRuleParametersZodSchema
>;

export type Requirement =
  | 'pull_request'
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
  codeOwners: {
    pattern: string;
    userIds: string[];
    teamIds: string[];
    tokens: string[];
  }[];
  unresolvedThreads: number;
};

export type RulesetEvaluation = {
  violations: Violation[];
  bypassed: Violation[];
};
