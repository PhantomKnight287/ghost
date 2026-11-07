import { schema } from '@ghost/db';

import type { CommitStatusState } from '../commit-statuses/commit-statuses.js';
import {
  ActionRequiredNeedsDetailsUrlError,
  CheckRunConclusionRequiredError,
} from './checks.errors.js';

export const CHECK_STATUSES = schema.checkStatus.enumValues;
export const CHECK_CONCLUSIONS = schema.checkConclusion.enumValues;
export const CHECK_ANNOTATION_LEVELS = schema.checkAnnotationLevel.enumValues;

export type CheckStatus = (typeof CHECK_STATUSES)[number];
export type CheckConclusion = (typeof CHECK_CONCLUSIONS)[number];

export const MAX_CHECK_NAME = 255;
export const MAX_OUTPUT_TITLE = 255;
export const MAX_OUTPUT_TEXT = 65535;
export const MAX_ANNOTATIONS_PER_REQUEST = 50;
export const MAX_ANNOTATIONS_PER_RUN = 1000;
export const MAX_RUNS_PER_NAME = 1000;
export const MAX_ACTIONS = 3;
export const MAX_ACTION_LABEL = 20;
export const MAX_ACTION_DESCRIPTION = 40;
export const MAX_ACTION_IDENTIFIER = 20;

const PASSING: readonly CheckConclusion[] = ['success', 'neutral', 'skipped'];

/** Worst first: a suite takes the first of these that any of its counted runs has. */
const SUITE_PRECEDENCE: readonly CheckConclusion[] = [
  'action_required',
  'cancelled',
  'timed_out',
  'failure',
  'neutral',
  'skipped',
  'success',
];

/** What a run counts as in a commit's combined state and for a required check. */
export function rollupState(run: {
  status: CheckStatus;
  conclusion: CheckConclusion | null;
}): CommitStatusState {
  if (run.status !== 'completed' || !run.conclusion) return 'pending';
  return PASSING.includes(run.conclusion) ? 'success' : 'failure';
}

/** The newest run of each name, by creation time and then numeric id. */
export function newestPerName<
  T extends { name: string; createdAt: Date; numericId: number },
>(runs: T[]): T[] {
  const newest = new Map<string, T>();
  for (const run of runs) {
    const kept = newest.get(run.name);
    if (
      !kept ||
      run.createdAt.getTime() > kept.createdAt.getTime() ||
      (run.createdAt.getTime() === kept.createdAt.getTime() &&
        run.numericId > kept.numericId)
    )
      newest.set(run.name, run);
  }
  return [...newest.values()];
}

export function suiteState(
  runs: {
    name: string;
    status: CheckStatus;
    conclusion: CheckConclusion | null;
    createdAt: Date;
    numericId: number;
  }[],
): { status: CheckStatus; conclusion: CheckConclusion | null } {
  const counted = newestPerName(runs);
  if (counted.some((run) => run.status !== 'completed'))
    return {
      // Every run gets a start time when created, so "started" means it left `queued`.
      status: counted.some((run) => run.status !== 'queued')
        ? 'in_progress'
        : 'queued',
      conclusion: null,
    };
  if (counted.length === 0) return { status: 'queued', conclusion: null };
  return {
    status: 'completed',
    conclusion:
      SUITE_PRECEDENCE.find((conclusion) =>
        counted.some((run) => run.conclusion === conclusion),
      ) ?? null,
  };
}

export type RunState = {
  status: CheckStatus;
  conclusion: CheckConclusion | null;
  startedAt: Date;
  completedAt: Date | null;
};

/** A run's lifecycle after a create (`current` null) or an update, with GitHub's implications: a conclusion or a completion time completes it, a completed run needs a conclusion, and `action_required` needs somewhere to send the user. `detailsUrl` is the one the run will have after the write. */
export function resolveRunWrite(
  current: RunState | null,
  body: {
    status?: CheckStatus;
    conclusion?: CheckConclusion;
    startedAt?: Date;
    completedAt?: Date;
    detailsUrl?: string | null;
  },
  now: Date,
): RunState {
  const completes =
    body.status === 'completed' ||
    body.conclusion !== undefined ||
    body.completedAt !== undefined;
  const status = completes
    ? 'completed'
    : (body.status ?? current?.status ?? 'queued');
  const conclusion = body.conclusion ?? current?.conclusion ?? null;
  if (status === 'completed' && !conclusion)
    throw new CheckRunConclusionRequiredError();
  if (conclusion === 'action_required' && !body.detailsUrl)
    throw new ActionRequiredNeedsDetailsUrlError();
  return {
    status,
    conclusion: status === 'completed' ? conclusion : null,
    startedAt: body.startedAt ?? current?.startedAt ?? now,
    completedAt:
      status === 'completed'
        ? (body.completedAt ?? current?.completedAt ?? now)
        : null,
  };
}
