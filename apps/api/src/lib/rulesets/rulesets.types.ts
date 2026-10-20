import { Role } from '@ghost/permissions';
import type { RefTransition } from '../git/wal/wal.types.js';

export type RuleType =
  | 'creation'
  | 'update'
  | 'deletion'
  | 'non_fast_forward'
  | 'required_linear_history';

export type Ruleset = {
  id: string;
  name: string;
  target: 'branch' | 'tag';
  enforcement: 'active' | 'disabled';
  include: string[];
  exclude: string[];
  bypassActors: BypassActor[];
  rules: { type: RuleType; parameters?: Record<string, unknown> }[];
};

export type BypassActor = {
  bypassMode: 'always' | 'pull_request';
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
  message: string;
};

export type BypassAnswer = 'always' | 'pull_requests_only' | 'never';

/** What the rulesets decided about a write, for exactly these transitions. */
export type RulesetVerdict = {
  transitions: RefTransition[];
  violations: Violation[];
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
