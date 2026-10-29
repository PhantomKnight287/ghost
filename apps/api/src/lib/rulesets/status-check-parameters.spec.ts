import { describe, expect, it } from 'vitest';

import { parseStatusCheckParameters } from './status-check-parameters.js';

describe('parseStatusCheckParameters', () => {
  it('fills in defaults', () => {
    expect(
      parseStatusCheckParameters({
        required_status_checks: [{ context: 'build' }],
      }),
    ).toEqual({
      ok: true,
      value: {
        required_status_checks: [{ context: 'build' }],
        strict_required_status_checks_policy: false,
        do_not_enforce_on_create: false,
      },
    });
  });

  it('takes integration_id as an App ID', () => {
    const parsed = parseStatusCheckParameters({
      required_status_checks: [{ context: 'build', integration_id: 15368 }],
    });
    expect(parsed.ok && parsed.value.required_status_checks).toEqual([
      { context: 'build', integration_id: 15368 },
    ]);
    expect(
      parseStatusCheckParameters({
        required_status_checks: [{ context: 'build', integration_id: 'ci' }],
      }).ok,
    ).toBe(false);
  });

  it('refuses an empty context', () => {
    expect(
      parseStatusCheckParameters({ required_status_checks: [{ context: '' }] })
        .ok,
    ).toBe(false);
  });

  it('refuses an unknown key', () => {
    expect(
      parseStatusCheckParameters({
        required_status_checks: [],
        required_reviewers: [],
      }).ok,
    ).toBe(false);
  });

  it('refuses a missing list', () => {
    expect(parseStatusCheckParameters({}).ok).toBe(false);
  });
});
