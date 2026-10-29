import { schema } from '@ghost/db';
import { Role } from '@ghost/permissions';
import { z } from 'zod';

import type { CommitStatusState } from '../commit-statuses/commit-statuses.js';
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
  | {
      actorType: 'Integration';
      /** The App ID. */
      appId: number;
    }
);

/** GitHub's numbers for the built-in repository roles, as its API and Terraform provider use them. */
export const GITHUB_ROLE_IDS = { maintain: 2, write: 4, admin: 5 } as const;

export type RulesetActor = {
  role: Role | null;
  teamIds: string[];
  organizationAdmin: boolean;
  /** The App ID when an app's bot is acting. */
  appId?: number | null;
};

export type RefFacts = {
  isFastForward: boolean;
  introducesMergeCommit: boolean;
  /** The judged commit's statuses on the base repository, newest first: the newest of each context per app that posted it (`appId`, the App ID), and the newest of each context posted without an app. */
  statuses?: {
    context: string;
    state: CommitStatusState;
    appId?: number | null;
  }[];
  /** Merges only: whether the head contains the base tip. */
  upToDate?: boolean;
  /** The commits the write adds that do not verify. */
  unverifiedCommits?: { sha: string; reason: string }[];
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
  write: 'push' | 'pull_request_merge';
  violations: Violation[];
  bypassed: Violation[];
  suites: RuleSuiteVerdict[];
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

/** GitHub's REST schema for the `required_status_checks` rule's parameters. `integration_id` pins a check to the app with that App ID. */
export const StatusCheckRuleParametersZodSchema = z.strictObject({
  required_status_checks: z.array(
    z.strictObject({
      context: z
        .string({ error: 'context must be a string' })
        .min(1, { error: 'context must not be empty' }),
      integration_id: z
        .int({ error: 'integration_id must be an integer' })
        .positive({ error: 'integration_id must be positive' })
        .optional(),
    }),
    { error: 'required_status_checks must be an array' },
  ),
  strict_required_status_checks_policy: z
    .boolean({
      error: 'strict_required_status_checks_policy must be a boolean',
    })
    .default(false),
  do_not_enforce_on_create: z
    .boolean({ error: 'do_not_enforce_on_create must be a boolean' })
    .default(false),
});

export type StatusCheckRuleParameters = z.infer<
  typeof StatusCheckRuleParametersZodSchema
>;

export const REQUIREMENTS = [
  'pull_request',
  'approvals',
  'changes_requested',
  'code_owners',
  'last_push',
  'threads',
  'merge_method',
  'status_checks',
  'up_to_date',
  'signatures',
] as const;
export type Requirement = (typeof REQUIREMENTS)[number];

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

export type RuleSuiteResult = 'pass' | 'fail' | 'bypass';

/** One rule of one ruleset, checked against one ref of a write. */
export type RuleEvaluation = {
  rulesetId: string;
  rulesetName: string;
  enforcement: 'active' | 'evaluate';
  rule: RuleType;
  result: 'pass' | 'fail';
  /** Unmet requirements of a failed `pull_request` rule, in the evaluator's order; empty otherwise. */
  requirements: Requirement[];
  details: string | null;
};

/** Every rule checked against one ref of a write. `evaluationResult` counts evaluate rulesets as if active, and is null when none applied. */
export type RuleSuiteVerdict = {
  transition: RefTransition;
  result: RuleSuiteResult;
  evaluationResult: RuleSuiteResult | null;
  evaluations: RuleEvaluation[];
};

export type RulesetEvaluation = {
  violations: Violation[];
  bypassed: Violation[];
  suites: RuleSuiteVerdict[];
};
