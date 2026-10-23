import { type Database, schema } from '@ghost/db';
import { atLeast } from '@ghost/permissions';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import type { Executor } from '../../lib/db/executor.js';
import { publishEvent } from '../../lib/events/events.js';
import { listBranches } from '../../lib/git/refs/list-refs.js';
import { listTags } from '../../lib/git/tags/list-tags.js';
import type { AuthorizedRepository } from '../../lib/repositories/access/repository-access.js';
import { bypassOf } from '../../lib/rulesets/evaluate-rulesets.js';
import {
  normalizeRefPattern,
  refTargeted,
} from '../../lib/rulesets/ref-pattern.js';
import { parsePullRequestParameters } from '../../lib/rulesets/pull-request-parameters.js';
import { parseStatusCheckParameters } from '../../lib/rulesets/status-check-parameters.js';
import { rulesetColumns } from '../../lib/rulesets/ruleset-columns.js';
import {
  InvalidBypassActorError,
  InvalidRuleParametersError,
  RulesetNameTakenError,
  RulesetNotFoundError,
} from '../../lib/rulesets/rulesets.errors.js';
import type {
  BypassAnswer,
  RuleType,
} from '../../lib/rulesets/rulesets.types.js';
import { RepositoryMaterializerService } from '../../services/git/materializer/repository-materializer.service.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { RulesetVerdictsService } from '../../services/rulesets/ruleset-verdicts.service.js';
import type {
  ProtectedRefDTO,
  RulesetDTO,
  RulesetPatternsDTO,
  RulesetRequestDTO,
} from './dto/ruleset.dto.js';

type RepositoryRef = { username: string; repo: string; requesterId?: string };

// Least first: a ref several rulesets target is only as open as the strictest of them.
const BYPASS_ORDER: BypassAnswer[] = ['never', 'pull_requests_only', 'always'];

/** Repository rulesets: the rules that guard refs, and who may skip them. Changes need admin; anyone who can read the repository sees them, but only admins see who bypasses. */
@Injectable()
export class RulesetsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: RepositoryAccessService,
    private readonly materializer: RepositoryMaterializerService,
    private readonly verdicts: RulesetVerdictsService,
  ) {}

  async list(target: RepositoryRef): Promise<RulesetDTO[]> {
    const repository = await this.access.authorize(target);
    const rulesets = await this.db
      .select(this.columns)
      .from(schema.ruleset)
      .where(eq(schema.ruleset.repositoryId, repository.id))
      .orderBy(asc(schema.ruleset.createdAt));
    return rulesets.map((ruleset) => this.asSeenBy(repository, ruleset));
  }

  async get({
    id,
    ...target
  }: RepositoryRef & { id: string }): Promise<RulesetDTO> {
    const repository = await this.access.authorize(target);
    return this.asSeenBy(
      repository,
      await this.byId(this.db, repository.id, id),
    );
  }

  async create({
    body,
    ...target
  }: RepositoryRef & { body: RulesetRequestDTO }): Promise<RulesetDTO> {
    const repository = await this.access.authorize({
      ...target,
      operation: 'admin',
    });
    await this.checkActors(repository, body);
    return this.db.transaction(async (tx) => {
      const [{ id }] = await tx
        .insert(schema.ruleset)
        .values({
          ...this.row(body),
          repositoryId: repository.id,
          createdById: target.requesterId,
        })
        .returning({ id: schema.ruleset.id })
        .catch(this.nameTaken(body.name));
      await this.insertChildren(tx, id, body);
      await publishEvent(tx, {
        type: 'repository_ruleset.created',
        repositoryId: repository.id,
        actorId: target.requesterId ?? null,
        payload: { rulesetId: id },
      });
      return this.byId(tx, repository.id, id);
    });
  }

  /** Replaces the whole ruleset: its rules and bypass actors are exactly the ones sent. */
  async update({
    id,
    body,
    ...target
  }: RepositoryRef & {
    id: string;
    body: RulesetRequestDTO;
  }): Promise<RulesetDTO> {
    const repository = await this.access.authorize({
      ...target,
      operation: 'admin',
    });
    await this.checkActors(repository, body);
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.ruleset)
        .set({ ...this.row(body), updatedAt: new Date() })
        .where(
          and(
            eq(schema.ruleset.id, id),
            eq(schema.ruleset.repositoryId, repository.id),
          ),
        )
        .returning({ id: schema.ruleset.id })
        .catch(this.nameTaken(body.name));
      if (!updated) throw new RulesetNotFoundError(id);
      await tx
        .delete(schema.rulesetRule)
        .where(eq(schema.rulesetRule.rulesetId, id));
      await tx
        .delete(schema.rulesetBypassActor)
        .where(eq(schema.rulesetBypassActor.rulesetId, id));
      await this.insertChildren(tx, id, body);
      await publishEvent(tx, {
        type: 'repository_ruleset.edited',
        repositoryId: repository.id,
        actorId: target.requesterId ?? null,
        payload: { rulesetId: id },
      });
      return this.byId(tx, repository.id, id);
    });
  }

  async remove({ id, ...target }: RepositoryRef & { id: string }) {
    const repository = await this.access.authorize({
      ...target,
      operation: 'admin',
    });
    await this.db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(schema.ruleset)
        .where(
          and(
            eq(schema.ruleset.id, id),
            eq(schema.ruleset.repositoryId, repository.id),
          ),
        )
        .returning({ name: schema.ruleset.name });
      if (!deleted) throw new RulesetNotFoundError(id);
      await publishEvent(tx, {
        type: 'repository_ruleset.deleted',
        repositoryId: repository.id,
        actorId: target.requesterId ?? null,
        payload: { rulesetId: id, name: deleted.name },
      });
    });
  }

  /** The existing refs the patterns target, by the same matcher enforcement uses. */
  async preview({
    patterns,
    ...target
  }: RepositoryRef & { patterns: RulesetPatternsDTO }) {
    const repository = await this.access.authorize({
      ...target,
      operation: 'admin',
    });
    const directory = await this.materializer.open(repository);
    const [refs, defaultBranch] = await Promise.all([
      this.refsOf(directory, patterns.target),
      this.verdicts.defaultBranchOf(repository, directory),
    ]);
    return {
      refs: refs
        .filter((ref) => refTargeted(patterns, ref, defaultBranch))
        .sort(),
    };
  }

  /** Each ref an active ruleset targets, with the rules that apply and how far the viewer may skip them. */
  async protectedRefs({
    refTarget,
    ...target
  }: RepositoryRef & { refTarget: RulesetPatternsDTO['target'] }) {
    const repository = await this.access.authorize(target);
    const rulesets = await this.verdicts.active(repository.id, refTarget);
    if (rulesets.length === 0) return { refs: {} };
    const directory = await this.materializer.open(repository);
    const [refs, defaultBranch, actor] = await Promise.all([
      this.refsOf(directory, refTarget),
      this.verdicts.defaultBranchOf(repository, directory),
      this.verdicts.actorOf(repository.id, target.requesterId ?? null),
    ]);
    const bypasses = new Map(
      rulesets.map((ruleset) => [ruleset, bypassOf(ruleset, actor)]),
    );

    const protectedRefs: Record<string, ProtectedRefDTO> = {};
    for (const ref of refs) {
      // A ruleset without rules restricts nothing, so it neither protects the ref nor limits its bypass.
      const applying = rulesets.filter(
        (ruleset) =>
          ruleset.rules.length > 0 && refTargeted(ruleset, ref, defaultBranch),
      );
      if (applying.length === 0) continue;
      protectedRefs[ref] = {
        rules: [
          ...new Set<RuleType>(
            applying.flatMap((ruleset) =>
              ruleset.rules.map(({ type }) => type),
            ),
          ),
        ],
        bypass:
          BYPASS_ORDER[
            Math.min(
              ...applying.map((ruleset) =>
                BYPASS_ORDER.indexOf(bypasses.get(ruleset)!),
              ),
            )
          ],
      };
    }
    return { refs: protectedRefs };
  }

  private readonly columns = {
    ...rulesetColumns,
    createdAt: schema.ruleset.createdAt,
    updatedAt: schema.ruleset.updatedAt,
  };

  private async byId(db: Executor, repositoryId: string, id: string) {
    const [ruleset] = await db
      .select(this.columns)
      .from(schema.ruleset)
      .where(
        and(
          eq(schema.ruleset.id, id),
          eq(schema.ruleset.repositoryId, repositoryId),
        ),
      );
    if (!ruleset) throw new RulesetNotFoundError(id);
    return ruleset;
  }

  private asSeenBy<Row extends RulesetDTO>(
    repository: AuthorizedRepository,
    { bypassActors, ...ruleset }: Row,
  ) {
    return {
      ...ruleset,
      ...(atLeast(repository.viewerRole, 'admin') && { bypassActors }),
    };
  }

  private row(
    body: RulesetRequestDTO,
  ): Omit<typeof schema.ruleset.$inferInsert, 'repositoryId'> {
    return {
      name: body.name,
      target: body.target,
      enforcement: body.enforcement,
      include: body.include.map((pattern) =>
        normalizeRefPattern(body.target, pattern),
      ),
      exclude: body.exclude.map((pattern) =>
        normalizeRefPattern(body.target, pattern),
      ),
    };
  }

  private async insertChildren(
    tx: Executor,
    rulesetId: string,
    body: RulesetRequestDTO,
  ) {
    if (body.rules.length > 0)
      await tx.insert(schema.rulesetRule).values(
        body.rules.map(({ type, parameters }) => ({
          rulesetId,
          type,
          parameters:
            type === 'pull_request'
              ? this.pullRequestParameters(parameters)
              : type === 'required_status_checks'
                ? this.statusCheckParameters(parameters)
                : {},
        })),
      );
    if (body.bypassActors.length > 0)
      await tx
        .insert(schema.rulesetBypassActor)
        .values(
          body.bypassActors.map((actor) => ({
            rulesetId,
            actorType: actor.actorType,
            bypassMode: actor.bypassMode,
            role: actor.actorType === 'RepositoryRole' ? actor.role : null,
            teamId: actor.actorType === 'Team' ? actor.teamId : null,
          })),
        )
        .onConflictDoNothing();
  }

  private pullRequestParameters(input: unknown) {
    const parsed = parsePullRequestParameters(input);
    if (!parsed.ok)
      throw new InvalidRuleParametersError('pull_request', parsed.message);
    return parsed.value;
  }

  private statusCheckParameters(input: unknown) {
    const parsed = parseStatusCheckParameters(input);
    if (!parsed.ok)
      throw new InvalidRuleParametersError(
        'required_status_checks',
        parsed.message,
      );
    return parsed.value;
  }

  /** Teams and organization admins exist only on an organization's repository, and a team must be one of that organization's. */
  private async checkActors(
    repository: AuthorizedRepository,
    body: RulesetRequestDTO,
  ) {
    const teamIds = body.bypassActors.flatMap((actor) =>
      actor.actorType === 'Team' ? [actor.teamId!] : [],
    );
    if (!repository.organizationId) {
      if (
        body.bypassActors.some(
          ({ actorType }) => actorType !== 'RepositoryRole',
        )
      )
        throw new InvalidBypassActorError(
          'Only repository roles can bypass rulesets on a personal repository',
        );
      return;
    }
    if (teamIds.length === 0) return;
    const found = await this.db
      .select({ id: schema.team.id })
      .from(schema.team)
      .where(
        and(
          inArray(schema.team.id, teamIds),
          eq(schema.team.organizationId, repository.organizationId),
        ),
      );
    const missing = teamIds.find((id) => !found.some((team) => team.id === id));
    if (missing)
      throw new InvalidBypassActorError(
        `No team ${missing} in this repository's organization`,
      );
  }

  private nameTaken(name: string) {
    return (error: unknown): never => {
      // drizzle wraps the driver's error as its cause.
      if ((error as { cause?: { code?: string } }).cause?.code === '23505')
        throw new RulesetNameTakenError(name);
      throw error;
    };
  }

  private async refsOf(
    directory: string,
    target: RulesetPatternsDTO['target'],
  ) {
    return target === 'branch'
      ? (await listBranches(directory)).map((name) => `refs/heads/${name}`)
      : (await listTags(directory)).map(({ name }) => `refs/tags/${name}`);
  }
}
