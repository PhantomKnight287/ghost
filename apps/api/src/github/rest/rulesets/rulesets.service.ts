import { type Database, schema } from '@ghost/db';
import { atLeast } from '@ghost/permissions';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, count, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';

import { DATABASE } from '../../../database/database.module.js';
import {
  GithubNotFoundError,
  UnprocessableError,
} from '../../../lib/github/github.errors.js';
import { encodeNodeId } from '../../../lib/github/node-id.js';
import { reviewsOf } from '../../../lib/github/node-lookup.js';
import { githubOrigins } from '../../../lib/github/origins.js';
import { pageOf, RestPage } from '../../../lib/github/rest.js';
import { bypassOf } from '../../../lib/rulesets/evaluate-rulesets.js';
import { refTargeted } from '../../../lib/rulesets/ref-pattern.js';
import { ruleSuiteFilter } from '../../../lib/rulesets/rule-suite-filter.js';
import { rulesetColumns } from '../../../lib/rulesets/ruleset-columns.js';
import {
  type BypassActor,
  GITHUB_ROLE_IDS,
} from '../../../lib/rulesets/rulesets.types.js';
import type {
  RulesetBypassActorDTO,
  RulesetRequestDTO,
} from '../../../resources/rulesets/dto/ruleset.dto.js';
import { RulesetsService } from '../../../resources/rulesets/rulesets.service.js';
import { RepositoryMaterializerService } from '../../../services/git/materializer/repository-materializer.service.js';
import { RulesetVerdictsService } from '../../../services/rulesets/ruleset-verdicts.service.js';
import type {
  GithubRepositoryTarget,
  GithubViewer,
} from '../../auth/github-request.js';
import type { RepositoryNode } from '../../graphql/types/repository.type.js';
import { GithubIssuesService } from '../issues/issues.service.js';
import type {
  GithubBypassActorDTO,
  GithubCreateRulesetDTO,
  GithubRuleSuiteQueryDTO,
  GithubRuleSuitesQueryDTO,
  GithubUpdateRulesetDTO,
} from './dto/rulesets.dto.js';

// GitHub caps the pull request metadata a suite carries.
const MAX_METADATA_REVIEWS = 50;

// GitHub sends 1 for the organization admin actor, whose id means nothing.
const ORGANIZATION_ADMIN_ID = 1;

const columns = {
  ...rulesetColumns,
  numericId: schema.ruleset.numericId,
  createdAt: schema.ruleset.createdAt,
  updatedAt: schema.ruleset.updatedAt,
};

type Row = Awaited<ReturnType<GithubRulesetsService['rows']>>[number];

/** GitHub's REST repository rulesets over RulesetsService, which owns validation, permissions and the outbox; this layer translates GitHub's numeric ids and shapes. */
@Injectable()
export class GithubRulesetsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly github: GithubIssuesService,
    private readonly rulesets: RulesetsService,
    private readonly verdicts: RulesetVerdictsService,
    private readonly config: ConfigService,
    private readonly materializer: RepositoryMaterializerService,
  ) {}

  async list({ owner, repo, viewer }: GithubRepositoryTarget) {
    const repository = await this.github.readable(owner, repo, viewer);
    const rows = await this.rows(
      eq(schema.ruleset.repositoryId, repository.ghostId),
    );
    return rows.map((row) => this.summary(repository, row));
  }

  async get(
    { owner, repo, viewer }: GithubRepositoryTarget,
    numericId: number,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    return this.detailed(
      repository,
      viewer,
      await this.byNumericId(repository, numericId),
    );
  }

  async create(target: GithubRepositoryTarget, body: GithubCreateRulesetDTO) {
    const { repository, viewer } = await this.github.writable(
      target.owner,
      target.repo,
      target.viewer,
      'POST /repos/:owner/:repo/rulesets',
    );
    const created = await this.rulesets.create({
      ...this.github.ref(repository, viewer),
      body: {
        name: body.name,
        target: body.target ?? 'branch',
        enforcement: body.enforcement,
        include: body.conditions?.ref_name.include ?? [],
        exclude: body.conditions?.ref_name.exclude ?? [],
        bypassActors: await this.bypassActorsOf(body.bypass_actors ?? []),
        rules: (body.rules ?? []).map(({ type, parameters }) => ({
          type,
          parameters,
        })),
      },
    });
    const [row] = await this.rows(eq(schema.ruleset.id, created.id));
    return this.detailed(repository, viewer, row);
  }

  async update(
    target: GithubRepositoryTarget,
    numericId: number,
    body: GithubUpdateRulesetDTO,
  ) {
    const { repository, viewer } = await this.github.writable(
      target.owner,
      target.repo,
      target.viewer,
      'PUT /repos/:owner/:repo/rulesets/:id',
    );
    const current = await this.byNumericId(repository, numericId);
    // Stored patterns carry the current target's prefix; without it, a new target prefixes them as its own.
    const reused = (patterns: string[]) =>
      patterns.map((pattern) =>
        pattern.replace(
          current.target === 'branch' ? /^refs\/heads\// : /^refs\/tags\//,
          '',
        ),
      );
    const next: RulesetRequestDTO = {
      name: body.name ?? current.name,
      target: body.target ?? current.target,
      enforcement: body.enforcement ?? current.enforcement,
      include: body.conditions?.ref_name.include ?? reused(current.include),
      exclude: body.conditions?.ref_name.exclude ?? reused(current.exclude),
      bypassActors: body.bypass_actors
        ? await this.bypassActorsOf(body.bypass_actors)
        : (current.bypassActors as RulesetBypassActorDTO[]),
      rules:
        body.rules?.map(({ type, parameters }) => ({ type, parameters })) ??
        current.rules,
    };
    await this.rulesets.update({
      ...this.github.ref(repository, viewer),
      id: current.id,
      body: next,
    });
    return this.detailed(
      repository,
      viewer,
      await this.byNumericId(repository, numericId),
    );
  }

  async remove(target: GithubRepositoryTarget, numericId: number) {
    const { repository, viewer } = await this.github.writable(
      target.owner,
      target.repo,
      target.viewer,
      'DELETE /repos/:owner/:repo/rulesets/:id',
    );
    const { id } = await this.byNumericId(repository, numericId);
    await this.rulesets.remove({ ...this.github.ref(repository, viewer), id });
  }

  /** Every rule an active branch ruleset applies to `branch`, each naming its ruleset. */
  async branchRules(
    { owner, repo, viewer }: GithubRepositoryTarget,
    branch: string,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const rows = await this.rows(
      and(
        eq(schema.ruleset.repositoryId, repository.ghostId),
        eq(schema.ruleset.enforcement, 'active'),
        eq(schema.ruleset.target, 'branch'),
      ),
    );
    if (rows.length === 0) return [];
    const defaultBranch = await this.verdicts.defaultBranchOf(
      repository,
      await this.materializer.open({
        id: repository.ghostId,
        defaultBranch: repository.defaultBranch,
      }),
    );
    return rows
      .filter((row) => refTargeted(row, `refs/heads/${branch}`, defaultBranch))
      .flatMap((row) =>
        row.rules.map(({ type, parameters }) => ({
          type,
          ...(parameters && { parameters }),
          ruleset_source_type: 'Repository',
          ruleset_source: repository.nameWithOwner,
          ruleset_id: row.numericId,
        })),
      );
  }

  /** Admins only, as GitHub hides rule insights from everyone else behind a 404. */
  async ruleSuites(
    { owner, repo, viewer }: GithubRepositoryTarget,
    query: GithubRuleSuitesQueryDTO,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    if (!atLeast(repository.viewerRole, 'admin'))
      throw new GithubNotFoundError();
    const page = pageOf(query);
    const where = ruleSuiteFilter({
      repositoryId: repository.ghostId,
      ref: query.ref,
      actorName: query.actor_name,
      result:
        query.rule_suite_result === 'all' ? undefined : query.rule_suite_result,
      enforcement:
        query.evaluate_status === 'all' ? undefined : query.evaluate_status,
      period: query.time_period ?? 'day',
    });
    const [suites, [{ total }]] = await Promise.all([
      this.suites(where)
        .orderBy(desc(schema.ruleSuite.createdAt), desc(schema.ruleSuite.id))
        .limit(page.perPage)
        .offset(page.offset),
      this.db.select({ total: count() }).from(schema.ruleSuite).where(where),
    ]);
    return new RestPage(
      suites.map((suite) => ({
        ...suite,
        repository_id: repository.databaseId,
        repository_name: repository.name,
      })),
      page,
      total,
    );
  }

  async ruleSuite(
    { owner, repo, viewer }: GithubRepositoryTarget,
    numericId: number,
    query: GithubRuleSuiteQueryDTO,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    if (!atLeast(repository.viewerRole, 'admin'))
      throw new GithubNotFoundError();
    const [found] = await this.db
      .select({
        id: schema.ruleSuite.id,
        pullRequestId: schema.ruleSuite.pullRequestId,
      })
      .from(schema.ruleSuite)
      .where(
        and(
          eq(schema.ruleSuite.repositoryId, repository.ghostId),
          eq(schema.ruleSuite.numericId, numericId),
        ),
      );
    if (!found) throw new GithubNotFoundError();
    const [[suite], evaluations, pullRequest] = await Promise.all([
      this.suites(eq(schema.ruleSuite.id, found.id)),
      this.db
        .select({
          rule_source: {
            type: sql<'ruleset'>`'ruleset'`,
            id: schema.ruleset.numericId,
            name: schema.ruleEvaluation.rulesetName,
          },
          enforcement: sql<
            'active' | 'evaluate' | 'deleted ruleset'
          >`case when ${schema.ruleEvaluation.rulesetId} is null then 'deleted ruleset' else ${schema.ruleEvaluation.enforcement}::text end`,
          result: schema.ruleEvaluation.result,
          rule_type: schema.ruleEvaluation.ruleType,
          details: schema.ruleEvaluation.details,
        })
        .from(schema.ruleEvaluation)
        .leftJoin(
          schema.ruleset,
          eq(schema.ruleset.id, schema.ruleEvaluation.rulesetId),
        )
        .where(eq(schema.ruleEvaluation.ruleSuiteId, found.id))
        .orderBy(asc(schema.ruleEvaluation.position)),
      query.include_metadata === 'true' && found.pullRequestId
        ? this.pullRequestMetadata(repository, found.pullRequestId)
        : null,
    ]);
    return {
      ...suite,
      repository_id: repository.databaseId,
      repository_name: repository.name,
      rule_evaluations: evaluations.map((evaluation) =>
        pullRequest && evaluation.rule_type === 'pull_request'
          ? { ...evaluation, metadata: { pull_request: pullRequest } }
          : evaluation,
      ),
    };
  }

  /** GitHub's rule suite fields that live on the suite row itself. */
  private suites(where: SQL | undefined) {
    return this.db
      .select({
        id: schema.ruleSuite.numericId,
        actor_id: schema.user.numericId,
        actor_name: schema.ruleSuite.actorName,
        before_sha: schema.ruleSuite.beforeSha,
        after_sha: schema.ruleSuite.afterSha,
        ref: schema.ruleSuite.ref,
        pushed_at: schema.ruleSuite.createdAt,
        result: schema.ruleSuite.result,
        evaluation_result: schema.ruleSuite.evaluationResult,
      })
      .from(schema.ruleSuite)
      .leftJoin(schema.user, eq(schema.user.id, schema.ruleSuite.actorId))
      .where(where);
  }

  /** The merged pull request as it is now, with its submitted reviews. */
  private async pullRequestMetadata(
    repository: RepositoryNode,
    pullRequestId: string,
  ) {
    const [[pullRequest], reviews] = await Promise.all([
      this.db
        .select({
          id: schema.issue.numericId,
          number: schema.issue.number,
          authorLogin: schema.user.username,
        })
        .from(schema.pullRequest)
        .innerJoin(
          schema.issue,
          eq(schema.issue.id, schema.pullRequest.issueId),
        )
        .leftJoin(schema.user, eq(schema.user.id, schema.issue.authorId))
        .where(eq(schema.pullRequest.id, pullRequestId)),
      reviewsOf(this.db, [pullRequestId]),
    ]);
    const shown = reviews
      .filter(({ submittedAt }) => submittedAt !== null)
      .slice(0, MAX_METADATA_REVIEWS);
    const { users } = await this.github.context(repository, {
      logins: [
        pullRequest.authorLogin ?? '',
        ...shown.map(({ authorLogin }) => authorLogin),
      ],
      labels: [],
    });
    return {
      id: pullRequest.id,
      number: pullRequest.number,
      user: users.get(pullRequest.authorLogin ?? '') ?? null,
      reviews: shown.map((review) => ({
        id: review.numericId,
        user: users.get(review.authorLogin) ?? null,
        state: review.dismissed
          ? 'DISMISSED'
          : (review.state ?? 'pending').toUpperCase(),
      })),
    };
  }

  private rows(where: SQL | undefined) {
    return this.db
      .select(columns)
      .from(schema.ruleset)
      .where(where)
      .orderBy(asc(schema.ruleset.createdAt));
  }

  private async byNumericId(repository: RepositoryNode, numericId: number) {
    const [row] = await this.rows(
      and(
        eq(schema.ruleset.repositoryId, repository.ghostId),
        eq(schema.ruleset.numericId, numericId),
      ),
    );
    if (!row) throw new GithubNotFoundError();
    return row;
  }

  /** What GitHub lists: no conditions, rules or bypass actors. */
  private summary(repository: RepositoryNode, row: Row) {
    const { api } = githubOrigins(this.config);
    return {
      id: row.numericId,
      name: row.name,
      target: row.target,
      source_type: 'Repository',
      source: repository.nameWithOwner,
      enforcement: row.enforcement,
      node_id: encodeNodeId('RepositoryRuleset', row.id),
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      _links: {
        self: {
          href: `${api}/api/v3/repos/${repository.nameWithOwner}/rulesets/${row.numericId}`,
        },
        html: { href: `${repository.url}/rules/${row.numericId}` },
      },
    };
  }

  /** One ruleset as GitHub returns it alone: with conditions, rules, whether the viewer can bypass, and bypass actors for admins. */
  private async detailed(
    repository: RepositoryNode,
    viewer: GithubViewer | null,
    row: Row,
  ) {
    const actor = await this.verdicts.actorOf(
      repository.ghostId,
      viewer?.userId ?? null,
    );
    return {
      ...this.summary(repository, row),
      conditions: { ref_name: { include: row.include, exclude: row.exclude } },
      rules: row.rules,
      ...(atLeast(repository.viewerRole, 'admin') && {
        bypass_actors: await this.githubBypassActorsOf(row.bypassActors),
      }),
      current_user_can_bypass: bypassOf(row, actor),
    };
  }

  private async githubBypassActorsOf(actors: BypassActor[]) {
    const teamIds = actors.flatMap((actor) =>
      actor.actorType === 'Team' ? [actor.teamId] : [],
    );
    const teams =
      teamIds.length > 0
        ? await this.db
            .select({ id: schema.team.id, numericId: schema.team.numericId })
            .from(schema.team)
            .where(inArray(schema.team.id, teamIds))
        : [];
    return actors.map((actor) => ({
      actor_id:
        actor.actorType === 'RepositoryRole'
          ? GITHUB_ROLE_IDS[actor.role]
          : actor.actorType === 'Team'
            ? teams.find((team) => team.id === actor.teamId)!.numericId
            : ORGANIZATION_ADMIN_ID,
      actor_type: actor.actorType,
      bypass_mode: actor.bypassMode,
    }));
  }

  /** GitHub's numeric actors as Ghost's; a role number or team id that names nothing is GitHub's 422. */
  private async bypassActorsOf(
    actors: GithubBypassActorDTO[],
  ): Promise<RulesetBypassActorDTO[]> {
    const teamNumericIds = actors.flatMap((actor) =>
      actor.actor_type === 'Team' ? [actor.actor_id!] : [],
    );
    const teams =
      teamNumericIds.length > 0
        ? await this.db
            .select({ id: schema.team.id, numericId: schema.team.numericId })
            .from(schema.team)
            .where(inArray(schema.team.numericId, teamNumericIds))
        : [];
    return actors.map(({ actor_id, actor_type, bypass_mode = 'always' }) => {
      if (actor_type === 'OrganizationAdmin')
        return { actorType: actor_type, bypassMode: bypass_mode };
      if (actor_type === 'Team') {
        const team = teams.find(({ numericId }) => numericId === actor_id);
        if (!team)
          throw new UnprocessableError(
            `Invalid actor_id ${actor_id} for actor_type Team`,
          );
        return {
          actorType: actor_type,
          teamId: team.id,
          bypassMode: bypass_mode,
        };
      }
      const role = Object.entries(GITHUB_ROLE_IDS).find(
        ([, id]) => id === actor_id,
      )?.[0] as keyof typeof GITHUB_ROLE_IDS | undefined;
      if (!role)
        throw new UnprocessableError(
          `Invalid actor_id ${actor_id} for actor_type RepositoryRole`,
        );
      return { actorType: actor_type, role, bypassMode: bypass_mode };
    });
  }
}
