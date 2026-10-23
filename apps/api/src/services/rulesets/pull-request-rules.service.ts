import { type Database, schema } from '@ghost/db';
import { atLeast } from '@ghost/permissions';
import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
} from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { matchingRule, ownerToken } from '../../lib/codeowners/codeowners.js';
import {
  diffIdentity,
  listDiffFiles,
  mergeBase,
} from '../../lib/git/diff/diff.js';
import { allowedMergeMethods } from '../../lib/rulesets/evaluate-rulesets.js';
import { refTargeted } from '../../lib/rulesets/ref-pattern.js';
import type {
  MergeMethod,
  PullRequestFacts,
  PullRequestRuleParameters,
  Ruleset,
} from '../../lib/rulesets/rulesets.types.js';
import { CodeownersService } from '../codeowners/codeowners.service.js';
import { RepositoryAccessService } from '../git/repository-access/repository-access.service.js';
import { RulesetVerdictsService } from './ruleset-verdicts.service.js';

/** A live pull request as `PullRequestsService.openLive` resolves it: the sides, the tips and the merge base. */
type Opened = {
  pullRequest: {
    id: string;
    authorId: string;
    baseRef: string;
    headPushedById: string | null;
  };
  base: { id: string; organizationId: string | null };
  baseDirectory: string;
  alternates: string[];
  baseSha: string;
  headSha: string;
  mergeBase: string | null;
};

/** The facts the `pull_request` rule judges a merge on, gathered from reviews, threads, CODEOWNERS and git. */
@Injectable()
export class PullRequestRulesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly codeowners: CodeownersService,
    private readonly access: RepositoryAccessService,
    private readonly verdicts: RulesetVerdictsService,
  ) {}

  /** The active rulesets, those with a `pull_request` rule on `baseRef`, and the merge methods they allow. No rulesets cost one query and no git command; `rulesets` skips even that. */
  async applicable(
    repository: { id: string; defaultBranch: string | null },
    gitDir: string,
    baseRef: string,
    rulesets?: Ruleset[],
  ) {
    const checked = rulesets ?? (await this.verdicts.checked(repository.id));
    if (checked.length === 0)
      return {
        rulesets: checked,
        pullRequestRules: [],
        allowedMethods: allowedMergeMethods([], '', ''),
      };
    const ref = `refs/heads/${baseRef}`;
    const defaultBranch = await this.verdicts.defaultBranchOf(
      repository,
      gitDir,
    );
    return {
      rulesets: checked,
      // Evaluate rulesets too: they are judged on the same facts, they only cannot refuse.
      pullRequestRules: checked.filter(
        (ruleset) =>
          ruleset.rules.some(({ type }) => type === 'pull_request') &&
          refTargeted(ruleset, ref, defaultBranch),
      ),
      allowedMethods: allowedMergeMethods(checked, ref, defaultBranch),
    };
  }

  /** Only the git work the rules ask for: CODEOWNERS and the changed files with `require_code_owner_review`, diff identity with `dismiss_stale_reviews_on_push` or `require_last_push_approval`. */
  async factsOf(
    git: Opened,
    rulesets: Ruleset[],
    method: MergeMethod,
  ): Promise<PullRequestFacts> {
    const wanted = (flag: keyof PullRequestRuleParameters) =>
      rulesets.some((ruleset) =>
        ruleset.rules.some(
          (rule) =>
            rule.type === 'pull_request' &&
            (rule.parameters as PullRequestRuleParameters)[flag] === true,
        ),
      );
    const codeOwnersWanted = wanted('require_code_owner_review');
    const [verdicts, codeOwners, unresolvedThreads] = await Promise.all([
      this.verdictsOf(
        git,
        wanted('dismiss_stale_reviews_on_push') ||
          wanted('require_last_push_approval'),
        codeOwnersWanted,
      ),
      codeOwnersWanted ? this.codeOwnersOf(git) : [],
      wanted('required_review_thread_resolution')
        ? this.unresolvedThreads(git.pullRequest.id)
        : 0,
    ]);
    return {
      authorId: git.pullRequest.authorId,
      method,
      approvals: verdicts.approvals,
      changesRequestedBy: verdicts.changesRequestedBy,
      headPushedById: git.pullRequest.headPushedById,
      codeOwners,
      unresolvedThreads,
    };
  }

  /** The ids of approvals that went stale, judged as a merge would judge them. */
  async staleApprovals(git: Opened) {
    const { approvals } = await this.verdictsOf(git, true, false);
    return approvals
      .filter(({ stale }) => stale)
      .map(({ reviewId }) => reviewId);
  }

  /** Each reviewer's latest verdict that still counts: not dismissed, not the author's, from someone with write access now. */
  private async verdictsOf(
    git: Opened,
    judgeStale: boolean,
    withTeams: boolean,
  ) {
    const latest = (
      await this.db
        .selectDistinctOn([schema.pullRequestReview.authorId], {
          reviewId: schema.pullRequestReview.id,
          userId: schema.pullRequestReview.authorId,
          state: schema.pullRequestReview.state,
          dismissed: isNotNull(schema.pullRequestReview.dismissalMessage),
          commitSha: schema.pullRequestReview.commitSha,
          baseSha: schema.pullRequestReview.baseSha,
        })
        .from(schema.pullRequestReview)
        .where(
          and(
            eq(schema.pullRequestReview.pullRequestId, git.pullRequest.id),
            isNotNull(schema.pullRequestReview.submittedAt),
            ne(schema.pullRequestReview.state, 'commented'),
            ne(schema.pullRequestReview.authorId, git.pullRequest.authorId),
          ),
        )
        .orderBy(
          schema.pullRequestReview.authorId,
          desc(schema.pullRequestReview.submittedAt),
        )
    ).filter(({ dismissed }) => !dismissed);
    const roles = await this.access.explicitRoles(git.base.id, [
      ...new Set(latest.map(({ userId }) => userId)),
    ]);
    const standing = latest.filter(({ userId }) =>
      atLeast(roles.get(userId) ?? null, 'write'),
    );
    const approved = standing.filter(({ state }) => state === 'approved');

    const teams =
      withTeams && approved.length > 0
        ? await this.db
            .select({
              userId: schema.teamMember.userId,
              teamId: schema.teamMember.teamId,
            })
            .from(schema.teamMember)
            .where(
              inArray(
                schema.teamMember.userId,
                approved.map(({ userId }) => userId),
              ),
            )
        : [];

    // ponytail: per-request git work for list queries; persist facts keyed by (head, base) if gh pr list gets slow
    const identities = new Map<string, Promise<string | null>>();
    const identityOf = (base: string, commit: string) => {
      const key = `${base}..${commit}`;
      let identity = identities.get(key);
      if (!identity) {
        identity = this.identityOf(git, base, commit);
        identities.set(key, identity);
      }
      return identity;
    };
    // GitHub's rule: stale once the change approved differs from the pull request's, each measured from its own merge base. The base moving on, or a merge of it that adds nothing, leaves the approval standing. A review from before base_sha was recorded is measured from today's base.
    const isStale = async (commitSha: string, baseSha: string | null) => {
      if (!judgeStale || commitSha === git.headSha) return false;
      const approvedChange = await identityOf(
        baseSha ?? git.baseSha,
        commitSha,
      );
      return (
        approvedChange === null ||
        approvedChange !== (await identityOf(git.baseSha, git.headSha))
      );
    };
    const approvals = await Promise.all(
      approved.map(async ({ reviewId, userId, commitSha, baseSha }) => ({
        reviewId,
        userId,
        teamIds: teams
          .filter((team) => team.userId === userId)
          .map(({ teamId }) => teamId),
        stale: await isStale(commitSha, baseSha),
      })),
    );
    return {
      approvals,
      changesRequestedBy: standing
        .filter(({ state }) => state === 'changes_requested')
        .map(({ userId }) => userId),
    };
  }

  /** The change `commit` makes over its merge base with `base`; null when either is gone. */
  private async identityOf(git: Opened, base: string, commit: string) {
    const range = { gitDir: git.baseDirectory, alternates: git.alternates };
    const from =
      base === git.baseSha && commit === git.headSha
        ? git.mergeBase
        : await mergeBase({ ...range, a: base, b: commit });
    if (!from) return null;
    return diffIdentity({ ...range, from, to: commit }).catch(() => null);
  }

  /** One entry per CODEOWNERS rule that owns a changed file and has an owner who can approve, read from the base so a pull request cannot pick its own reviewers. */
  private async codeOwnersOf(
    git: Opened,
  ): Promise<PullRequestFacts['codeOwners']> {
    if (!git.mergeBase) return [];
    const loaded = await this.codeowners.load(
      git.base,
      git.baseDirectory,
      git.baseSha,
    );
    if (!loaded) return [];
    const files = await listDiffFiles({
      gitDir: git.baseDirectory,
      alternates: git.alternates,
      from: git.mergeBase,
      to: git.headSha,
    });
    const owned = new Map<string, PullRequestFacts['codeOwners'][number]>();
    for (const file of files) {
      const owners = this.codeowners.ownersOf(loaded, file.path);
      if (owners.length === 0) continue;
      const { pattern } = matchingRule(loaded.rules, file.path)!;
      if (owned.has(pattern)) continue;
      owned.set(pattern, {
        pattern,
        userIds: owners.flatMap((owner) =>
          owner.kind === 'user' ? [owner.userId] : [],
        ),
        teamIds: owners.flatMap((owner) =>
          owner.kind === 'team' ? [owner.teamId] : [],
        ),
        tokens: owners.map(ownerToken),
      });
    }
    return [...owned.values()];
  }

  /** Threads are their first comments; one in a pending review is not there yet. */
  private async unresolvedThreads(pullRequestId: string) {
    const [row] = await this.db
      .select({ count: count() })
      .from(schema.pullRequestReviewComment)
      .innerJoin(
        schema.pullRequestReview,
        eq(
          schema.pullRequestReview.id,
          schema.pullRequestReviewComment.reviewId,
        ),
      )
      .where(
        and(
          eq(schema.pullRequestReviewComment.pullRequestId, pullRequestId),
          isNull(schema.pullRequestReviewComment.inReplyToId),
          isNull(schema.pullRequestReviewComment.resolvedAt),
          isNotNull(schema.pullRequestReview.submittedAt),
        ),
      );
    return row?.count ?? 0;
  }
}
