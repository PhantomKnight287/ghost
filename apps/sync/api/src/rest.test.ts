import { expect, test } from "bun:test";
import { createRest, RestError } from "./rest.ts";

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

function setup(replies: Reply[]) {
  const requests: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  let tokens = 0;
  const fetch = (async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    const reply = replies.shift();
    if (!reply) throw new Error("unexpected fetch");
    const body = reply.status === 204 ? null : JSON.stringify(reply.body ?? {});
    return new Response(body, { status: reply.status, headers: reply.headers });
  }) as unknown as typeof globalThis.fetch;
  const rest = createRest({
    baseUrl: "https://api.example.com/api/v3",
    graphqlUrl: "https://api.example.com/api/graphql",
    token: async () => `ghs_${++tokens}`,
    fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { rest, requests, sleeps };
}

const header = (init: RequestInit | undefined, name: string) => new Headers(init?.headers).get(name);

test("asks for the token on every request and sends it as Bearer", async () => {
  const { rest, requests } = setup([{ status: 200, body: { a: 1 } }, { status: 200, body: { b: 2 } }]);
  expect(await rest.request("GET", "/repos/o/r")).toEqual({ a: 1 });
  await rest.request("GET", "/repos/o/r");
  expect(header(requests[0]?.init, "authorization")).toBe("Bearer ghs_1");
  expect(header(requests[1]?.init, "authorization")).toBe("Bearer ghs_2");
  expect(header(requests[0]?.init, "accept")).toBe("application/vnd.github+json");
  expect(requests[0]?.url).toBe("https://api.example.com/api/v3/repos/o/r");
});

test("sends a JSON body", async () => {
  const { rest, requests } = setup([{ status: 201, body: { number: 1 } }]);
  await rest.request("POST", "/repos/o/r/issues", { title: "t" });
  expect(requests[0]?.init.method).toBe("POST");
  expect(JSON.parse(String(requests[0]?.init.body))).toEqual({ title: "t" });
  expect(header(requests[0]?.init, "content-type")).toBe("application/json");
});

test("retries 5xx with growing delays", async () => {
  const { rest, sleeps } = setup([{ status: 502 }, { status: 502 }, { status: 200, body: { ok: true } }]);
  expect(await rest.request("GET", "/x")).toEqual({ ok: true });
  expect(sleeps).toHaveLength(2);
  expect(sleeps[1]).toBeGreaterThan(sleeps[0] ?? Infinity);
});

test("429 honors Retry-After", async () => {
  const { rest, sleeps } = setup([{ status: 429, headers: { "retry-after": "7" } }, { status: 200, body: {} }]);
  await rest.request("GET", "/x");
  expect(sleeps).toEqual([7000]);
});

test("GitHub's secondary rate limit is retried", async () => {
  const { rest, requests } = setup([{ status: 403, body: { message: "You have exceeded a secondary rate limit." } }, { status: 200, body: {} }]);
  await rest.request("GET", "/x");
  expect(requests).toHaveLength(2);
});

test("a plain 403 is not retried", async () => {
  const { rest, requests } = setup([{ status: 403, body: { message: "Resource not accessible by integration" } }]);
  const error = await rest.request("GET", "/x").catch((e: unknown) => e);
  expect(error).toBeInstanceOf(RestError);
  expect((error as RestError).status).toBe(403);
  expect((error as RestError).body).toEqual({ message: "Resource not accessible by integration" });
  expect((error as RestError).message).toBe("403 Resource not accessible by integration");
  expect(requests).toHaveLength(1);
});

test("RestError's message is the status and the host's message", () => {
  expect(new RestError(404, { message: "Not Found" }).message).toBe("404 Not Found");
  expect(new RestError(200, [{ message: "Could not resolve" }]).message).toBe("200 Could not resolve");
  expect(new RestError(502, null).message).toBe("502");
});

test("other 4xx are not retried", async () => {
  const { rest, requests } = setup([{ status: 422, body: { message: "Validation Failed" } }]);
  await expect(rest.request("POST", "/x", {})).rejects.toBeInstanceOf(RestError);
  expect(requests).toHaveLength(1);
});

test("gives up after 5 attempts", async () => {
  const { rest, requests } = setup(Array.from({ length: 5 }, () => ({ status: 500 })));
  const error = await rest.request("GET", "/x").catch((e: unknown) => e);
  expect((error as RestError).status).toBe(500);
  expect(requests).toHaveLength(5);
});

test("204 resolves undefined", async () => {
  const { rest } = setup([{ status: 204 }]);
  expect(await rest.request("DELETE", "/x")).toBeUndefined();
});

test("paginate follows Link rel=next", async () => {
  const { rest, requests } = setup([
    { status: 200, body: [1, 2], headers: { link: '<https://api.example.com/api/v3/x?page=2>; rel="next", <https://api.example.com/api/v3/x?page=2>; rel="last"' } },
    { status: 200, body: [3] },
  ]);
  const items: number[] = [];
  for await (const item of rest.paginate<number>("/x")) items.push(item);
  expect(items).toEqual([1, 2, 3]);
  expect(requests[1]?.url).toBe("https://api.example.com/api/v3/x?page=2");
});

test("paginate unwraps { total_count, <key>: [] } pages", async () => {
  const { rest } = setup([{ status: 200, body: { total_count: 2, installations: [{ id: 1 }, { id: 2 }] } }]);
  const items: unknown[] = [];
  for await (const item of rest.paginate("/user/installations")) items.push(item);
  expect(items).toEqual([{ id: 1 }, { id: 2 }]);
});

test("graphql posts query and variables and returns data", async () => {
  const { rest, requests } = setup([{ status: 200, body: { data: { deleteIssue: { clientMutationId: null } } } }]);
  const data = await rest.graphql("mutation($id: ID!) { deleteIssue(input: { issueId: $id }) { clientMutationId } }", { id: "I_1" });
  expect(data).toEqual({ deleteIssue: { clientMutationId: null } });
  expect(requests[0]?.url).toBe("https://api.example.com/api/graphql");
  expect(JSON.parse(String(requests[0]?.init.body))).toEqual({ query: expect.stringContaining("deleteIssue"), variables: { id: "I_1" } });
  expect(header(requests[0]?.init, "authorization")).toBe("Bearer ghs_1");
});

test("graphql errors in a 200 throw", async () => {
  const errors = [{ message: "Resource not accessible by integration" }];
  const { rest } = setup([{ status: 200, body: { data: null, errors } }]);
  const error = await rest.graphql("mutation { x }", {}).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(RestError);
  expect((error as RestError).status).toBe(200);
  expect((error as RestError).body).toEqual(errors);
});
