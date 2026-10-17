import { describe, expect, it } from 'vitest';

import { combinedState } from './commit-statuses.js';

describe('combinedState', () => {
  it('is pending when there are no statuses', () => {
    expect(combinedState([])).toBe('pending');
  });

  it('is success only when every status succeeded', () => {
    expect(combinedState(['success', 'success'])).toBe('success');
  });

  it('is pending while any status is pending', () => {
    expect(combinedState(['success', 'pending'])).toBe('pending');
  });

  it('is failure for an error, even beside a pending status', () => {
    expect(combinedState(['pending', 'error'])).toBe('failure');
  });

  it('is failure when any status failed', () => {
    expect(combinedState(['failure', 'success'])).toBe('failure');
  });
});
