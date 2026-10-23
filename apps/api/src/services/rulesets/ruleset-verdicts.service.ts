import { type Database, schema } from '@ghost/db';
import { administers, organizationRoleOf } from '@ghost/permissions';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import {
  addedCommits,
  peeledCommit,
} from '../../lib/git/refs/added-commits.js';
import { type RefTransition, ZERO_OID } from '../../lib/git/wal/wal.types.js';
import {
  acceptedCollaboration,
  basePermissionOf,
  organizationMembership,
  roleOf,
  teamRoleOf,
} from '../../lib/repositories/access/repository-access.js';
import { resolveDefaultRef } from '../../lib/git/tree/resolve-ref.js';
import { evaluateRulesets } from '../../lib/rulesets/evaluate-rulesets.js';
import { refTargeted } from '../../lib/rulesets/ref-pattern.js';
import { rulesetColumns } from '../../lib/rulesets/ruleset-columns.js';
import type {
  PullRequestFacts,
  RefFacts,
  Ruleset,
  RulesetActor,
  RulesetVerdict,
  RuleType,
} from '../../lib/rulesets/rulesets.types.js';
import { CommitStatusesService } from '../../resources/commit-statuses/commit-statuses.service.js';
import { CommitVerificationService } from '../gpg/commit-verification.service.js';

const NOBODY: RulesetActor = {
  role: null,
  teamIds: [],
  organizationAdmin: false,
};

/** Judges ref writes against a repository's rulesets, for `commitPush` to accept. */
@Injectable()
export class RulesetVerdictsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly statuses: CommitStatusesService,
    private readonly verification: CommitVerificationService,
  ) {}

  active(repositoryId: string, target?: Ruleset['target']): Promise<Ruleset[]> {
    return this.withEnforcement(repositoryId, ['active'], target);
  }

  /** Active and evaluate rulesets: everything a write is checked against, whether or not it can refuse it. */
  checked(
    repositoryId: string,
    target?: Ruleset['target'],
  ): Promise<Ruleset[]> {
    return this.withEnforcement(repositoryId, ['active', 'evaluate'], target);
  }

  private withEnforcement(
    repositoryId: string,
    enforcement: Ruleset['enforcement'][],
    target?: Ruleset['target'],
  ): Promise<Ruleset[]> {
    return this.db
      .select(rulesetColumns)
      .from(schema.ruleset)
      .where(
        and(
          eq(schema.ruleset.repositoryId, repositoryId),
          inArray(schema.ruleset.enforcement, enforcement),
          target && eq(schema.ruleset.target, target),
        ),
      );
  }

  /** The user as bypass actors see them, in one query. */
  async actorOf(
    repositoryId: string,
    userId: string | null,
  ): Promise<RulesetActor> {
    if (!userId) return NOBODY;
    const actor = { userId };
    const [row] = await this.db
      .select({
        repository: {
          ownerId: schema.repository.ownerId,
          organizationId: schema.repository.organizationId,
        },
        collaboratorRole: schema.repositoryCollaborator.role,
        memberRole: schema.member.role,
        teamRole: teamRoleOf(schema.repository.id, actor),
        basePermission: basePermissionOf(schema.repository.organizationId),
        teamIds: sql<
          string[]
        >`array(select ${schema.teamMember.teamId} from ${schema.teamMember} where ${schema.teamMember.userId} = ${userId})`,
      })
      .from(schema.repository)
      .leftJoin(
        schema.repositoryCollaborator,
        acceptedCollaboration(schema.repository.id, actor),
      )
      .leftJoin(
        schema.member,
        organizationMembership(schema.repository.organizationId, actor),
      )
      .where(eq(schema.repository.id, repositoryId));
    if (!row) return NOBODY;
    return {
      role: roleOf(row.repository, row, actor),
      teamIds: row.teamIds,
      organizationAdmin: administers(organizationRoleOf(row.memberRole)),
    };
  }

  /** The branch `~DEFAULT_BRANCH` means: the repository row's, or HEAD's when the row names none. */
  async defaultBranchOf(
    repository: { defaultBranch: string | null },
    gitDir: string,
  ) {
    return (
      await resolveDefaultRef({
        gitDir,
        defaultBranch: repository.defaultBranch,
      })
    ).replace(/^refs\/heads\//, '');
  }

  /** `repository` must be the row read for this write, so `~DEFAULT_BRANCH` never follows a stale name. A repository without active or evaluate rulesets costs one query, no actor lookup and no git command. */
  async judge({
    repository,
    gitDir,
    userId,
    write,
    transitions,
    facts = new Map(),
    rulesets,
    pullRequest,
    env,
  }: {
    repository: { id: string; defaultBranch: string | null };
    gitDir: string;
    /** Points git at a push's quarantine, where the commits status check and signature rules read still are. */
    env?: Record<string, string>;
    userId: string | null;
    write: 'push' | 'pull_request_merge';
    transitions: RefTransition[];
    facts?: Map<string, RefFacts>;
    /** Already loaded by a caller that needed them to decide which facts to compute. */
    rulesets?: Ruleset[];
    pullRequest?: PullRequestFacts;
  }): Promise<RulesetVerdict> {
    const applicable = rulesets ?? (await this.checked(repository.id));
    if (applicable.length === 0)
      return { transitions, write, violations: [], bypassed: [], suites: [] };
    const [actor, defaultBranch] = await Promise.all([
      this.actorOf(repository.id, userId),
      this.defaultBranchOf(repository, gitDir),
    ]);
    return {
      transitions,
      write,
      ...evaluateRulesets({
        rulesets: applicable,
        actor,
        write,
        transitions,
        facts: await this.withConditions({
          repositoryId: repository.id,
          gitDir,
          env,
          transitions,
          facts,
          rulesets: applicable,
          defaultBranch,
        }),
        defaultBranch,
        pullRequest,
      }),
    };
  }

  /** `facts` plus the statuses and unverified commits that status check and signature rules read, for each ref such a rule targets whose caller left them out. A merge supplies its own: what it lands is not the transition's new tip. */
  private async withConditions({
    repositoryId,
    gitDir,
    env,
    transitions,
    facts,
    rulesets,
    defaultBranch,
  }: {
    repositoryId: string;
    gitDir: string;
    env?: Record<string, string>;
    transitions: RefTransition[];
    facts: Map<string, RefFacts>;
    rulesets: Ruleset[];
    defaultBranch: string;
  }) {
    const wanting = (type: RuleType) =>
      transitions.filter(
        ({ ref, newOid }) =>
          !newOid.equals(ZERO_OID) &&
          rulesets.some(
            (ruleset) =>
              ruleset.enforcement !== 'disabled' &&
              ruleset.rules.some((rule) => rule.type === type) &&
              refTargeted(ruleset, ref, defaultBranch),
          ),
      );
    const checked = wanting('required_status_checks').filter(
      ({ ref }) => !facts.get(ref)?.statuses,
    );
    const signed = wanting('required_signatures').filter(
      ({ ref }) => !facts.get(ref)?.unverifiedCommits,
    );
    if (checked.length === 0 && signed.length === 0) return facts;

    const filled = new Map(facts);
    // A ref nobody computed facts for gets the failing ones, so filling conditions never opens another rule.
    const update = (ref: string, conditions: Partial<RefFacts>) =>
      filled.set(ref, {
        isFastForward: false,
        introducesMergeCommit: true,
        ...filled.get(ref),
        ...conditions,
      });

    if (checked.length > 0) {
      const tips = await Promise.all(
        checked.map(({ newOid }) =>
          peeledCommit({ gitDir, env, oid: newOid.toString('hex') }),
        ),
      );
      // Only the repository's own statuses count: a fork's owner can post anything on their fork.
      const combined = await this.statuses.combinedFor([repositoryId], tips);
      checked.forEach(({ ref }, index) =>
        update(ref, {
          statuses: (combined.get(tips[index])?.statuses ?? []).map(
            ({ context, state }) => ({ context, state }),
          ),
        }),
      );
    }

    if (signed.length > 0) {
      const added = await Promise.all(
        signed.map((transition) => addedCommits({ gitDir, env, transition })),
      );
      // ponytail: verification is linear in the commits a push adds; cache verdicts by sha and key set if first pushes of large histories show it.
      const verdicts = await this.verification.verifyCommits({
        gitDir,
        env,
        commits: [
          ...new Map(
            added.flat().map((commit) => [commit.sha, commit]),
          ).values(),
        ],
      });
      signed.forEach(({ ref }, index) =>
        update(ref, {
          unverifiedCommits: added[index].flatMap(({ sha }) => {
            const verdict = verdicts.get(sha);
            return verdict?.verified
              ? []
              : [{ sha, reason: verdict?.reason ?? 'Unsigned' }];
          }),
        }),
      );
    }
    return filled;
  }
}
