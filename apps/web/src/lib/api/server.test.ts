import { describe, expect, it } from "bun:test";

import { fetchApi, notFoundIfHidden } from "./server";

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

describe("fetchApi", () => {
  const connectError = (code: string) =>
    Object.assign(new TypeError("fetch failed"), { cause: { code } });

  it("retries while the API is still waking up, then gives up", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls < 3) throw connectError("ETIMEDOUT");
      return new Response("ok");
    }) as unknown as typeof fetch;
    try {
      expect(await (await fetchApi("http://api.test")).text()).toBe("ok");

      calls = -10;
      await expect(fetchApi("http://api.test")).rejects.toThrow("fetch failed");
      expect(calls).toBe(-7);

      calls = 0;
      globalThis.fetch = (async () => {
        calls++;
        throw connectError("ECONNRESET");
      }) as unknown as typeof fetch;
      await expect(fetchApi("http://api.test")).rejects.toThrow("fetch failed");
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});
