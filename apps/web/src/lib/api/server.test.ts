import { describe, expect, it } from "bun:test";

import { notFoundIfHidden } from "./server";

describe("notFoundIfHidden", () => {
  it("404s a missing resource, and a private one asked for anonymously", () => {
    for (const status of [404, 401]) {
      expect(() => notFoundIfHidden(new Response(null, { status }))).toThrow(
        "NEXT_HTTP_ERROR_FALLBACK;404",
      );
    }
  });

  it("lets every other answer through to the caller", () => {
    for (const status of [200, 403, 500]) {
      expect(() =>
        notFoundIfHidden(new Response(null, { status })),
      ).not.toThrow();
    }
  });
});
