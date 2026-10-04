import { describe, expect, test } from "bun:test";

import { PermanentImportError } from "./errors.ts";
import {
  GitHubClient,
  issueNumberOf,
  loginOf,
  nextLink,
  rateLimitDelay,
  wait,
} from "./github.ts";

const never = new AbortController().signal;

function fakeFetch(responses: Response[]) {
  const urls: string[] = [];
  const impl = (async (url: URL) => {
    urls.push(url.toString());
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next;
  }) as unknown as typeof fetch;
  return { impl, urls };
}

describe("rateLimitDelay", () => {
  test("reads retry-after", () => {
    expect(
      rateLimitDelay(
        new Response(null, { status: 429, headers: { "retry-after": "7" } }),
        0,
      ),
    ).toBe(7000);
  });

  test("waits for the reset when the quota is spent", () => {
    const response = new Response(null, {
      status: 403,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "100" },
    });
    expect(rateLimitDelay(response, 90_000)).toBe(11_000);
  });

  test("is null for a 403 that is not a rate limit, and for other statuses", () => {
    expect(rateLimitDelay(new Response(null, { status: 403 }), 0)).toBeNull();
    expect(rateLimitDelay(new Response(null, { status: 500 }), 0)).toBeNull();
  });
});

test("nextLink finds rel=next and nothing else", () => {
  expect(
    nextLink(
      '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=9>; rel="last"',
    )?.toString(),
  ).toBe("https://api.github.com/x?page=2");
  expect(nextLink('<https://api.github.com/x?page=1>; rel="prev"')).toBeNull();
  expect(nextLink(null)).toBeNull();
});

test("issueNumberOf and loginOf", () => {
  expect(issueNumberOf("https://api.github.com/repos/o/r/issues/42")).toBe(42);
  expect(loginOf({ login: "octocat" })).toBe("octocat");
  expect(loginOf(null)).toBe("ghost");
});

describe("GitHubClient", () => {
  test("pages follow the Link header", async () => {
    const { impl, urls } = fakeFetch([
      Response.json([1, 2], {
        headers: { link: '<https://api.github.com/items?page=2>; rel="next"' },
      }),
      Response.json([3]),
    ]);
    const pages: number[][] = [];
    for await (const page of new GitHubClient("t", never, impl).pages<number>(
      "/items",
    ))
      pages.push(page);
    expect(pages).toEqual([[1, 2], [3]]);
    expect(urls[0]).toBe("https://api.github.com/items?per_page=100");
  });

  test("waits out a short rate limit and tries again", async () => {
    const waited: number[] = [];
    const { impl } = fakeFetch([
      new Response(null, { status: 429, headers: { "retry-after": "2" } }),
      Response.json({ ok: true }),
    ]);
    const client = new GitHubClient("t", never, impl, async (ms) => {
      waited.push(ms);
    });
    expect(await client.get<{ ok: boolean }>("/x")).toEqual({ ok: true });
    expect(waited).toEqual([2000]);
  });

  test("gives up on a long rate limit with a retryable error", async () => {
    const { impl } = fakeFetch([
      new Response(null, { status: 429, headers: { "retry-after": "7200" } }),
    ]);
    const error = await new GitHubClient("t", never, impl)
      .get("/x")
      .catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PermanentImportError);
  });

  test("a token refused from the start is permanent, one that expires mid-attempt is not", async () => {
    const never401 = await new GitHubClient(
      "t",
      never,
      fakeFetch([new Response("Bad credentials", { status: 401 })]).impl,
    )
      .get("/x")
      .catch((e) => e);
    expect(never401).toBeInstanceOf(PermanentImportError);

    const client = new GitHubClient(
      "t",
      never,
      fakeFetch([
        Response.json({}),
        new Response("Bad credentials", { status: 401 }),
      ]).impl,
    );
    await client.get("/repos/o/r");
    const expired = await client.get("/x").then(
      () => null,
      (e: Error) => e,
    );
    expect(expired).toBeInstanceOf(Error);
    expect(expired).not.toBeInstanceOf(PermanentImportError);
    expect(expired?.message).toContain("expired");
  });

  test("a missing repository is permanent, a server error is not", async () => {
    const missing = await new GitHubClient(
      "t",
      never,
      fakeFetch([new Response("nope", { status: 404 })]).impl,
    )
      .get("/x")
      .catch((e) => e);
    expect(missing).toBeInstanceOf(PermanentImportError);
    const broken = await new GitHubClient(
      "t",
      never,
      fakeFetch([new Response("oops", { status: 502 })]).impl,
    )
      .get("/x")
      .catch((e) => e);
    expect(broken).not.toBeInstanceOf(PermanentImportError);
  });
});

describe("wait", () => {
  test("resolves after the delay", async () => {
    await wait(1, never);
  });

  test("rejects when aborted, before or during", async () => {
    const before = new AbortController();
    before.abort(new Error("stop"));
    await expect(wait(1000, before.signal)).rejects.toThrow("stop");

    const during = new AbortController();
    const pending = wait(1000, during.signal);
    during.abort(new Error("later"));
    await expect(pending).rejects.toThrow("later");
  });
});
