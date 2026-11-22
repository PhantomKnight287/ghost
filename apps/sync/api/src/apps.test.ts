import { expect, test } from "bun:test";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { createAppAuth } from "./apps.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const apiUrl = "https://api.example.com/api/v3";
const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

function setup(responses: { status: number; body: unknown }[]) {
  let now = 1_800_000_000_000;
  const requests: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof globalThis.fetch;
  const auth = createAppAuth({ appId: 7, privateKey, apiUrl, fetch, now: () => now });
  return { auth, requests, advance: (ms: number) => (now += ms), now: () => now };
}

const token = (value: string, expiresAtMs: number) => ({ status: 201, body: { token: value, expires_at: new Date(expiresAtMs).toISOString() } });

test("jwt claims and signature", () => {
  const { auth, now } = setup([]);
  const jwt = auth.jwt();
  const [header, payload, signature] = jwt.split(".") as [string, string, string];
  expect(decode(header)).toEqual({ alg: "RS256", typ: "JWT" });
  const seconds = Math.floor(now() / 1000);
  expect(decode(payload)).toEqual({ iss: "7", iat: seconds - 60, exp: seconds + 540 });
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${header}.${payload}`);
  expect(verifier.verify(publicKey, Buffer.from(signature, "base64url"))).toBe(true);
});

test("mints at GitHub's path with the jwt", async () => {
  const { auth, requests } = setup([token("ghs_a", now0() + 3_600_000)]);
  expect(await auth.installationToken(42)).toBe("ghs_a");
  expect(requests[0]?.url).toBe(`${apiUrl}/app/installations/42/access_tokens`);
  expect(requests[0]?.init.method).toBe("POST");
  const authorization = new Headers(requests[0]?.init.headers).get("authorization") ?? "";
  expect(authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  expect(decode(authorization.split(".")[1] ?? "").iss).toBe("7");
});

test("reuses a token until 5 minutes before expiry", async () => {
  const { auth, requests, advance } = setup([token("ghs_a", now0() + 3_600_000)]);
  await auth.installationToken(42);
  advance(3_600_000 - 300_000 - 1);
  expect(await auth.installationToken(42)).toBe("ghs_a");
  expect(requests).toHaveLength(1);
});

test("refreshes from 5 minutes before expiry", async () => {
  const { auth, requests, advance } = setup([token("ghs_a", now0() + 3_600_000), token("ghs_b", now0() + 7_200_000)]);
  await auth.installationToken(42);
  advance(3_600_000 - 300_000);
  expect(await auth.installationToken(42)).toBe("ghs_b");
  expect(requests).toHaveLength(2);
});

test("caches per installation", async () => {
  const { auth, requests } = setup([token("ghs_a", now0() + 3_600_000), token("ghs_c", now0() + 3_600_000)]);
  expect(await auth.installationToken(42)).toBe("ghs_a");
  expect(await auth.installationToken(43)).toBe("ghs_c");
  expect(await auth.installationToken(42)).toBe("ghs_a");
  expect(requests).toHaveLength(2);
});

test("a refused mint throws with the status and is not cached", async () => {
  const { auth, requests } = setup([{ status: 404, body: { message: "Not Found" } }, token("ghs_a", now0() + 3_600_000)]);
  await expect(auth.installationToken(42)).rejects.toThrow(/404/);
  expect(await auth.installationToken(42)).toBe("ghs_a");
  expect(requests).toHaveLength(2);
});

test("callers asking at once share one mint", async () => {
  const { auth, requests } = setup([token("ghs_a", now0() + 3_600_000)]);
  expect(await Promise.all([auth.installationToken(42), auth.installationToken(42)])).toEqual(["ghs_a", "ghs_a"]);
  expect(requests).toHaveLength(1);
});

test("a mint carries a timeout, and a refusal's error carries the host's answer", async () => {
  const { auth, requests } = setup([{ status: 401, body: { message: "Bad credentials" } }]);
  await expect(auth.installationToken(42)).rejects.toThrow(/401.*Bad credentials/);
  expect(requests[0]?.init.signal).toBeInstanceOf(AbortSignal);
});

function now0() {
  return 1_800_000_000_000;
}
