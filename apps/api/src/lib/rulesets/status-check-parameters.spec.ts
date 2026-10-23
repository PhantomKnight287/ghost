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

  it('refuses integration_id until Ghost Apps exist', () => {
    expect(
      parseStatusCheckParameters({
        required_status_checks: [{ context: 'build', integration_id: 15368 }],
      }),
    ).toEqual({
      ok: false,
      message:
        'integration_id needs Ghost Apps, which this server does not have yet',
    });
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
