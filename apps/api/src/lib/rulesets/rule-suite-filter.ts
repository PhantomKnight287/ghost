import { schema } from '@ghost/db';
import { and, eq, exists, gte, or, type SQL, sql } from 'drizzle-orm';

import type { RuleSuiteResult } from './rulesets.types.js';

export const RULE_SUITE_PERIODS = [
  'hour',
  'day',
  'week',
  'month',
  'all',
] as const;
export type RuleSuitePeriod = (typeof RULE_SUITE_PERIODS)[number];

const INTERVALS: Record<Exclude<RuleSuitePeriod, 'all'>, string> = {
  hour: '1 hour',
  day: '1 day',
  week: '7 days',
  month: '1 month',
};

export type RuleSuiteFilters = {
  repositoryId: string;
  rulesetId?: string;
  /** A full ref, or a branch or tag name GitHub-style: `main` matches `refs/heads/main` and `refs/tags/main`. */
  ref?: string;
  actorName?: string;
  result?: RuleSuiteResult;
  enforcement?: 'active' | 'evaluate';
  period: RuleSuitePeriod;
};

/** The rule suites the filters keep, as GitHub's rule-suites list and the Insights page filter them. */
export function ruleSuiteFilter(filters: RuleSuiteFilters): SQL | undefined {
  const evaluated = (condition: SQL | undefined) =>
    exists(
      sql`(select 1 from ${schema.ruleEvaluation} where ${and(eq(schema.ruleEvaluation.ruleSuiteId, schema.ruleSuite.id), condition)})`,
    );
  return and(
    eq(schema.ruleSuite.repositoryId, filters.repositoryId),
    filters.ref === undefined
      ? undefined
      : filters.ref.startsWith('refs/')
        ? eq(schema.ruleSuite.ref, filters.ref)
        : or(
            eq(schema.ruleSuite.ref, `refs/heads/${filters.ref}`),
            eq(schema.ruleSuite.ref, `refs/tags/${filters.ref}`),
          ),
    filters.actorName === undefined
      ? undefined
      : eq(schema.ruleSuite.actorName, filters.actorName),
    filters.result === undefined
      ? undefined
      : eq(schema.ruleSuite.result, filters.result),
    filters.rulesetId === undefined
      ? undefined
      : evaluated(eq(schema.ruleEvaluation.rulesetId, filters.rulesetId)),
    filters.enforcement === undefined
      ? undefined
      : evaluated(eq(schema.ruleEvaluation.enforcement, filters.enforcement)),
    filters.period === 'all'
      ? undefined
      : gte(
          schema.ruleSuite.createdAt,
          sql`now() - ${INTERVALS[filters.period]}::interval`,
        ),
  );
}
