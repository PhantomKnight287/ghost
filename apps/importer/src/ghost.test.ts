import { expect, test } from "bun:test";

import { StaleAttemptError } from "./errors.ts";
import { GhostCallbacks } from "./ghost.ts";

function callbacks(responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: URL, init: RequestInit) => {
    calls.push({ url: url.toString(), init });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  const sleeps: number[] = [];
  const ghost = new GhostCallbacks(
    "http://api:3001",
    "s3cret",
    "import_1",
    "attempt-1",
    impl,
    async (ms) => {
      sleeps.push(ms);
    },
  );
  return { ghost, calls, sleeps };
}

test("posts the attempt with the secret", async () => {
  const { ghost, calls } = callbacks([new Response(null, { status: 204 })]);
  await ghost.releases([]);
  expect(calls[0]!.url).toBe(
    "http://api:3001/api/internal/imports/import_1/releases",
  );
  expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
    attempt: "attempt-1",
    releases: [],
  });
  expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(
    "Bearer s3cret",
  );
});

test("a 409 means the attempt is stale", async () => {
  const { ghost } = callbacks([new Response(null, { status: 409 })]);
  await expect(ghost.heartbeat()).rejects.toBeInstanceOf(StaleAttemptError);
});

test("retries server errors and network failures, then succeeds", async () => {
  const { ghost, sleeps } = callbacks([
    new Response(null, { status: 503 }),
    new Error("ECONNREFUSED"),
    new Response(null, { status: 204 }),
  ]);
  await ghost.issues([]);
  expect(sleeps).toEqual([1_000, 5_000]);
});

test("gives up after the last retry", async () => {
  const { ghost } = callbacks([
    new Error("down"),
    new Error("down"),
    new Error("down"),
    new Error("down"),
  ]);
  await expect(ghost.comments([])).rejects.toThrow(
    "The API did not take comments: down",
  );
});

test("a 4xx other than 409 is not retried", async () => {
  const { ghost, sleeps } = callbacks([new Response("bad", { status: 400 })]);
  await expect(
    ghost.finish({ succeeded: true, defaultBranch: "main" }),
  ).rejects.toThrow("The API refused finish with 400: bad");
  expect(sleeps).toEqual([]);
});
