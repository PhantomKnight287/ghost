import { type Database, schema } from '@ghost/db';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import type { DomainError } from '../../domain/errors.js';
import { keyset } from '../../lib/db/keyset.js';
import { errorMessage } from '../../lib/error-message.js';
import { ruleSuiteFilter } from '../../lib/rulesets/rule-suite-filter.js';
import { RulesetViolationError } from '../../lib/rulesets/rulesets.errors.js';
import type {
  Requirement,
  RulesetVerdict,
} from '../../lib/rulesets/rulesets.types.js';
import type {
  ListRuleSuitesQueryDTO,
  ListRuleSuitesResponseDTO,
  RuleEvaluationDTO,
} from '../../resources/rulesets/dto/rule-suite.dto.js';
import { RepositoryAccessService } from '../git/repository-access/repository-access.service.js';

const DEFAULT_PAGE_SIZE = 30;

type RepositoryRef = { username: string; repo: string; requesterId?: string };

/** The repository's rule insights: one suite per ref of each write the rulesets checked. */
@Injectable()
export class RuleSuitesService {
  private readonly logger = new Logger(RuleSuitesService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: RepositoryAccessService,
  ) {}

  /** Admins only, newest first. */
  async list({
    query,
    ...target
  }: RepositoryRef & {
    query: ListRuleSuitesQueryDTO;
  }): Promise<ListRuleSuitesResponseDTO> {
    const repository = await this.access.authorize({
      ...target,
      operation: 'admin',
    });
    const list = keyset({
      cursor: query.cursor,
      limit: query.limit ?? DEFAULT_PAGE_SIZE,
      keys: {
        createdAt: schema.ruleSuite.createdAt,
        id: schema.ruleSuite.id,
      },
    });
    const { page, nextCursor } = list.page(
      await this.db
        .select({
          id: schema.ruleSuite.id,
          actor: { id: schema.user.id, username: schema.user.username },
          actorName: schema.ruleSuite.actorName,
          ref: schema.ruleSuite.ref,
          beforeSha: schema.ruleSuite.beforeSha,
          afterSha: schema.ruleSuite.afterSha,
          write: schema.ruleSuite.write,
          pullRequest: { number: schema.issue.number },
          result: schema.ruleSuite.result,
          evaluationResult: schema.ruleSuite.evaluationResult,
          createdAt: schema.ruleSuite.createdAt,
        })
        .from(schema.ruleSuite)
        .leftJoin(schema.user, eq(schema.user.id, schema.ruleSuite.actorId))
        .leftJoin(
          schema.pullRequest,
          eq(schema.pullRequest.id, schema.ruleSuite.pullRequestId),
        )
        .leftJoin(schema.issue, eq(schema.issue.id, schema.pullRequest.issueId))
        .where(
          and(
            ruleSuiteFilter({
              repositoryId: repository.id,
              rulesetId: query.rulesetId,
              ref: query.ref,
              actorName: query.actor,
              result: query.result,
              enforcement: query.enforcement,
              period: query.period ?? 'day',
            }),
            list.where,
          ),
        )
        .orderBy(...list.orderBy)
        .limit(list.limit),
    );

    const rows =
      page.length === 0
        ? []
        : await this.db
            .select({
              ruleSuiteId: schema.ruleEvaluation.ruleSuiteId,
              rulesetId: schema.ruleEvaluation.rulesetId,
              rulesetName: schema.ruleEvaluation.rulesetName,
              enforcement: sql<
                'active' | 'evaluate' | 'deleted ruleset'
              >`case when ${schema.ruleEvaluation.rulesetId} is null then 'deleted ruleset' else ${schema.ruleEvaluation.enforcement}::text end`,
              rule: schema.ruleEvaluation.ruleType,
              result: schema.ruleEvaluation.result,
              // Only the evaluator writes the column, and it writes requirement names.
              requirements: sql<
                Requirement[]
              >`${schema.ruleEvaluation.requirements}`,
              details: schema.ruleEvaluation.details,
            })
            .from(schema.ruleEvaluation)
            .where(
              inArray(
                schema.ruleEvaluation.ruleSuiteId,
                page.map(({ id }) => id),
              ),
            )
            .orderBy(asc(schema.ruleEvaluation.position));
    const evaluations = new Map<string, RuleEvaluationDTO[]>();
    for (const { ruleSuiteId, ...evaluation } of rows)
      evaluations.set(ruleSuiteId, [
        ...(evaluations.get(ruleSuiteId) ?? []),
        evaluation,
      ]);
    return {
      ruleSuites: page.map((suite) => ({
        ...suite,
        evaluations: evaluations.get(suite.id) ?? [],
      })),
      nextCursor,
    };
  }

  /** Refuses with `refusal` (a RulesetViolationError unless given) and records `fail` when the verdict found violations; otherwise runs `write` and records once it lands. A write that throws records nothing. */
  async attempt<T>(
    context: {
      repositoryId: string;
      actorId: string | null;
      verdict: RulesetVerdict;
      pullRequestId?: string;
      refusal?: DomainError;
    },
    write: () => Promise<T>,
  ): Promise<T> {
    const { verdict } = context;
    if (verdict.violations.length > 0) {
      await this.record(context);
      throw context.refusal ?? new RulesetViolationError(verdict.violations);
    }
    const written = await write();
    await this.record(context);
    return written;
  }

  /** Never rejects: the write it follows has already been decided, and a missing record must not change that decision. */
  private async record({
    repositoryId,
    actorId,
    verdict,
    pullRequestId,
  }: {
    repositoryId: string;
    actorId: string | null;
    verdict: RulesetVerdict;
    pullRequestId?: string;
  }) {
    if (verdict.suites.length === 0) return;
    try {
      await this.db.transaction(async (tx) => {
        const [actor] = actorId
          ? await tx
              .select({ username: schema.user.username })
              .from(schema.user)
              .where(eq(schema.user.id, actorId))
          : [];
        for (const {
          transition,
          result,
          evaluationResult,
          evaluations,
        } of verdict.suites) {
          const [{ id }] = await tx
            .insert(schema.ruleSuite)
            .values({
              repositoryId,
              actorId,
              actorName: actor?.username ?? null,
              ref: transition.ref,
              beforeSha: transition.oldOid.toString('hex'),
              afterSha: transition.newOid.toString('hex'),
              write: verdict.write,
              pullRequestId,
              result,
              evaluationResult,
            })
            .returning({ id: schema.ruleSuite.id });
          await tx.insert(schema.ruleEvaluation).values(
            evaluations.map((evaluation, position) => ({
              ruleSuiteId: id,
              position,
              rulesetId: evaluation.rulesetId,
              rulesetName: evaluation.rulesetName,
              enforcement: evaluation.enforcement,
              ruleType: evaluation.rule,
              result: evaluation.result,
              requirements: evaluation.requirements,
              details: evaluation.details,
            })),
          );
        }
      });
    } catch (error) {
      this.logger.warn(
        `Rule suites were not recorded for ${repositoryId}: ${errorMessage(error)}`,
      );
    }
  }
}
