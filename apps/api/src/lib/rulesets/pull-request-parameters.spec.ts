import { describe, expect, it } from 'vitest';

import { parsePullRequestParameters } from './pull-request-parameters.js';

const full = {
  required_approving_review_count: 2,
  dismiss_stale_reviews_on_push: true,
  require_code_owner_review: true,
  require_last_push_approval: true,
  required_review_thread_resolution: true,
  allowed_merge_methods: ['squash', 'rebase'],
};

const refused = (input: unknown) => {
  const result = parsePullRequestParameters(input);
  expect(result).toMatchObject({ ok: false, message: expect.any(String) });
  return result;
};

describe('parsePullRequestParameters', () => {
  it('keeps every parameter given', () => {
    expect(parsePullRequestParameters(full)).toEqual({ ok: true, value: full });
  });

  it("fills omitted fields with GitHub's defaults: no approvals, every flag off, every merge method", () => {
    const defaults = {
      required_approving_review_count: 0,
      dismiss_stale_reviews_on_push: false,
      require_code_owner_review: false,
      require_last_push_approval: false,
      required_review_thread_resolution: false,
      allowed_merge_methods: ['merge', 'squash', 'rebase'],
    };
    expect(parsePullRequestParameters({})).toEqual({
      ok: true,
      value: defaults,
    });
    expect(parsePullRequestParameters(undefined)).toEqual({
      ok: true,
      value: defaults,
    });
    expect(
      parsePullRequestParameters({ require_code_owner_review: true }),
    ).toEqual({
      ok: true,
      value: { ...defaults, require_code_owner_review: true },
    });
  });

  it('takes the approval count from 0 to 10', () => {
    for (const count of [0, 1, 10]) {
      expect(
        parsePullRequestParameters({
          ...full,
          required_approving_review_count: count,
        }),
      ).toMatchObject({
        ok: true,
        value: { required_approving_review_count: count },
      });
    }
  });

  it('refuses an approval count outside 0 to 10, or not an integer', () => {
    for (const count of [-1, 11, 1.5, '2', null, Number.NaN]) {
      refused({ ...full, required_approving_review_count: count });
    }
  });

  it('refuses a flag that is not a boolean', () => {
    for (const key of [
      'dismiss_stale_reviews_on_push',
      'require_code_owner_review',
      'require_last_push_approval',
      'required_review_thread_resolution',
    ]) {
      refused({ ...full, [key]: 'true' });
      refused({ ...full, [key]: 1 });
    }
  });

  it('refuses no merge method, an unknown one, or one named twice', () => {
    refused({ ...full, allowed_merge_methods: [] });
    refused({ ...full, allowed_merge_methods: ['fast-forward'] });
    refused({ ...full, allowed_merge_methods: ['squash', 'squash'] });
    refused({ ...full, allowed_merge_methods: 'squash' });
  });

  it('refuses unknown keys, including the preview parameters Ghost does not support', () => {
    refused({ ...full, teleport: true });
    refused({ ...full, required_reviewers: [] });
    refused({ ...full, automatic_copilot_code_review_enabled: false });
  });

  it('refuses a body that is not an object', () => {
    for (const input of [null, [], 'pull_request', 3]) refused(input);
  });

  it('names the offending field in the message', () => {
    const result = parsePullRequestParameters({
      ...full,
      required_approving_review_count: 11,
    });
    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining('required_approving_review_count'),
    });
  });
});
