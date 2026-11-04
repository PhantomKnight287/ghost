import { describe, expect, it, mock, spyOn } from "bun:test";

import { fakeApi } from "@/lib/api/fake-api";

mock.module("next/headers", () => ({ headers: async () => new Headers() }));

const { createServerClient, fetchApi, notFoundIfHidden } = await import(
  "./server"
);

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
    const wait = spyOn(globalThis, "setTimeout").mockImplementation(((
      resolve: () => void,
    ) => resolve()) as unknown as typeof setTimeout);
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls < 3) throw connectError("ETIMEDOUT");
      return new Response("ok");
    }) as unknown as typeof fetch;
    try {
      expect(await (await fetchApi("http://api.test")).text()).toBe("ok");

      calls = -100;
      await expect(fetchApi("http://api.test")).rejects.toThrow("fetch failed");
      expect(calls).toBe(-80);

      calls = 0;
      globalThis.fetch = (async () => {
        calls++;
        throw connectError("ECONNRESET");
      }) as unknown as typeof fetch;
      await expect(fetchApi("http://api.test")).rejects.toThrow("fetch failed");
      expect(calls).toBe(1);

      for (const status of [401, 403, 429]) {
        calls = 0;
        globalThis.fetch = (async () => {
          calls++;
          return new Response(null, { status });
        }) as unknown as typeof fetch;
        expect((await fetchApi("http://api.test")).status).toBe(status);
        expect(calls).toBe(1);
      }
    } finally {
      globalThis.fetch = original;
      wait.mockRestore();
    }
  });
});

describe("createServerClient", () => {
  async function logged(answer: unknown) {
    const restore = fakeApi({ "/api/repositories/ghost/ghost/issues": answer });
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      const client = await createServerClient();
      await client.GET("/api/repositories/{username}/{repo}/issues", {
        params: { path: { username: "ghost", repo: "ghost" } },
      });
      return error.mock.calls.map((call) => call.join(" "));
    } finally {
      error.mockRestore();
      restore();
    }
  }

  it("logs a failed call with its method, path, status and the API's message", async () => {
    expect(
      await logged(
        Response.json({ message: "relation does not exist" }, { status: 500 }),
      ),
    ).toEqual([
      "API GET /api/repositories/ghost/ghost/issues answered 500: relation does not exist",
    ]);
    expect(await logged(new Response("Bad Gateway", { status: 502 }))).toEqual([
      "API GET /api/repositories/ghost/ghost/issues answered 502: Bad Gateway",
    ]);
  });

  it("stays quiet on answers a page expects, such as a hidden resource", async () => {
    for (const status of [401, 403, 404]) expect(await logged(status)).toEqual([]);
    expect(await logged({ issues: [] })).toEqual([]);
  });
});
