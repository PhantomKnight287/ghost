import { describe, expect, it } from 'vitest';

import {
  ActionRequiredNeedsDetailsUrlError,
  CheckRunConclusionRequiredError,
} from './checks.errors.js';
import {
  type CheckConclusion,
  resolveRunWrite,
  rollupState,
  suiteState,
} from './checks.js';

const NOW = new Date('2026-11-06T12:00:00.000Z');
const EARLIER = new Date('2026-11-06T11:00:00.000Z');

describe('rollupState', () => {
  it.each([
    ['success', 'success'],
    ['neutral', 'success'],
    ['skipped', 'success'],
    ['failure', 'failure'],
    ['cancelled', 'failure'],
    ['timed_out', 'failure'],
    ['action_required', 'failure'],
  ] as const)('a run completed with %s counts as %s', (conclusion, state) => {
    expect(rollupState({ status: 'completed', conclusion })).toBe(state);
  });

  it.each(['queued', 'in_progress'] as const)(
    'a %s run is pending',
    (status) => {
      expect(rollupState({ status, conclusion: null })).toBe('pending');
    },
  );
});

describe('suiteState', () => {
  let numericId = 0;
  const run = (
    name: string,
    status: 'queued' | 'in_progress' | 'completed',
    conclusion: CheckConclusion | null = null,
    createdAt = NOW,
  ) => ({
    name,
    status,
    conclusion,
    startedAt: status === 'queued' ? null : createdAt,
    createdAt,
    numericId: ++numericId,
  });

  it('a suite with no runs is queued', () => {
    expect(suiteState([])).toEqual({ status: 'queued', conclusion: null });
  });

  it('is in progress once a run started and another has not finished', () => {
    expect(
      suiteState([run('a', 'completed', 'success'), run('b', 'queued')]),
    ).toEqual({ status: 'in_progress', conclusion: null });
  });

  it('stays queued while no run has started', () => {
    expect(suiteState([run('a', 'queued'), run('b', 'queued')])).toEqual({
      status: 'queued',
      conclusion: null,
    });
  });

  it.each([
    'action_required',
    'cancelled',
    'timed_out',
    'failure',
    'neutral',
    'skipped',
  ] as const)('%s outranks success', (conclusion) => {
    expect(
      suiteState([
        run('a', 'completed', 'success'),
        run('b', 'completed', conclusion),
      ]),
    ).toEqual({ status: 'completed', conclusion });
  });

  it('ranks action_required over cancelled over timed_out over failure over neutral over skipped', () => {
    const order = [
      'action_required',
      'cancelled',
      'timed_out',
      'failure',
      'neutral',
      'skipped',
      'success',
    ] as const;
    for (let i = 0; i < order.length - 1; i++)
      expect(
        suiteState([
          run('a', 'completed', order[i + 1]),
          run('b', 'completed', order[i]),
        ]).conclusion,
      ).toBe(order[i]);
  });

  it('counts only the newest run per name, so a re-run that passes clears the failure', () => {
    expect(
      suiteState([
        run('test', 'completed', 'failure', EARLIER),
        run('test', 'completed', 'success', NOW),
      ]),
    ).toEqual({ status: 'completed', conclusion: 'success' });
  });

  it('a queued re-run puts the suite back in progress', () => {
    expect(
      suiteState([
        run('lint', 'completed', 'success', EARLIER),
        run('test', 'completed', 'failure', EARLIER),
        run('test', 'queued', null, NOW),
      ]).status,
    ).toBe('in_progress');
  });

  it('breaks a tie in creation time by numeric id', () => {
    const first = run('test', 'completed', 'failure', NOW);
    const second = run('test', 'completed', 'success', NOW);
    expect(suiteState([second, first]).conclusion).toBe('success');
  });
});

describe('resolveRunWrite', () => {
  it('a new run is queued and started now', () => {
    expect(resolveRunWrite(null, {}, NOW)).toEqual({
      status: 'queued',
      conclusion: null,
      startedAt: NOW,
      completedAt: null,
    });
  });

  it('keeps a given start time', () => {
    expect(resolveRunWrite(null, { startedAt: EARLIER }, NOW).startedAt).toBe(
      EARLIER,
    );
  });

  it('a conclusion completes the run, stamping it now', () => {
    expect(resolveRunWrite(null, { conclusion: 'success' }, NOW)).toEqual({
      status: 'completed',
      conclusion: 'success',
      startedAt: NOW,
      completedAt: NOW,
    });
  });

  it('completed_at implies completed', () => {
    expect(
      resolveRunWrite(
        null,
        { completedAt: EARLIER, conclusion: 'failure' },
        NOW,
      ),
    ).toMatchObject({ status: 'completed', completedAt: EARLIER });
  });

  it('refuses completed without a conclusion', () => {
    expect(() => resolveRunWrite(null, { status: 'completed' }, NOW)).toThrow(
      CheckRunConclusionRequiredError,
    );
    expect(() => resolveRunWrite(null, { completedAt: EARLIER }, NOW)).toThrow(
      CheckRunConclusionRequiredError,
    );
  });

  it('an update keeps what it does not change', () => {
    const current = resolveRunWrite(null, { status: 'in_progress' }, EARLIER);
    expect(resolveRunWrite(current, {}, NOW)).toEqual(current);
  });

  it('an update can complete a run that was in progress', () => {
    const current = resolveRunWrite(null, { status: 'in_progress' }, EARLIER);
    expect(resolveRunWrite(current, { conclusion: 'success' }, NOW)).toEqual({
      status: 'completed',
      conclusion: 'success',
      startedAt: EARLIER,
      completedAt: NOW,
    });
  });

  it('a completed run can change its conclusion and keeps its completion time', () => {
    const current = resolveRunWrite(null, { conclusion: 'failure' }, EARLIER);
    expect(resolveRunWrite(current, { conclusion: 'success' }, NOW)).toEqual({
      ...current,
      conclusion: 'success',
    });
  });

  it('action_required needs a details URL', () => {
    expect(() =>
      resolveRunWrite(null, { conclusion: 'action_required' }, NOW),
    ).toThrow(ActionRequiredNeedsDetailsUrlError);
    expect(
      resolveRunWrite(
        null,
        { conclusion: 'action_required', detailsUrl: 'https://ci.example.com' },
        NOW,
      ).conclusion,
    ).toBe('action_required');
  });
});
