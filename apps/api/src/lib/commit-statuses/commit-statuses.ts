export const COMMIT_STATUS_STATES = [
  'pending',
  'success',
  'failure',
  'error',
] as const;

export type CommitStatusState = (typeof COMMIT_STATUS_STATES)[number];

export const MAX_STATUS_DESCRIPTION = 140;
export const MAX_STATUSES_PER_CONTEXT = 1000;
export const DEFAULT_STATUS_CONTEXT = 'default';

export function combinedState(states: CommitStatusState[]): CommitStatusState {
  if (states.some((s) => s === 'failure' || s === 'error')) return 'failure';
  if (states.length === 0 || states.includes('pending')) return 'pending';
  return 'success';
}
