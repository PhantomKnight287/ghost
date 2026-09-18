import { describe, expect, it } from "bun:test";

import { shouldRedirectToSignIn } from "./use-authenticate";

describe("shouldRedirectToSignIn", () => {
  it("waits out a refetch instead of bouncing on a stale null", () => {
    expect(
      shouldRedirectToSignIn({
        data: null,
        isPending: false,
        isFetching: true,
      }),
    ).toBe(false);
  });

  it("redirects once the session is settled and empty", () => {
    expect(
      shouldRedirectToSignIn({
        data: null,
        isPending: false,
        isFetching: false,
      }),
    ).toBe(true);
  });

  it("stays put with a session, and while the first fetch is pending", () => {
    expect(
      shouldRedirectToSignIn({
        data: { user: {} },
        isPending: false,
        isFetching: false,
      }),
    ).toBe(false);
    expect(
      shouldRedirectToSignIn({ data: null, isPending: true, isFetching: true }),
    ).toBe(false);
  });
});
