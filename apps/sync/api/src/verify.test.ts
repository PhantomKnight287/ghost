import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { verifyGhost, verifyGitHub } from "./verify.ts";

const secret = "whsec_test";
const body = new TextEncoder().encode('{"event":"push"}');
const hex = (data: string | Uint8Array) => `sha256=${createHmac("sha256", secret).update(data).digest("hex")}`;
const ts = 1_800_000_000;
const ghostSignature = (timestamp: number, raw = body) => hex(Buffer.concat([Buffer.from(`${timestamp}.`), raw]));

describe("Ghost", () => {
  test("valid", () => {
    expect(verifyGhost(secret, body, String(ts), ghostSignature(ts), ts)).toBe(true);
  });
  test("a flipped byte fails", () => {
    const tampered = new Uint8Array(body);
    tampered[2] = (tampered[2] ?? 0) ^ 1;
    expect(verifyGhost(secret, tampered, String(ts), ghostSignature(ts), ts)).toBe(false);
  });
  test("a signature over another timestamp fails", () => {
    expect(verifyGhost(secret, body, String(ts + 1), ghostSignature(ts), ts)).toBe(false);
  });
  test("missing headers fail", () => {
    expect(verifyGhost(secret, body, null, ghostSignature(ts), ts)).toBe(false);
    expect(verifyGhost(secret, body, String(ts), null, ts)).toBe(false);
  });
  test("a signature of another length fails without throwing", () => {
    expect(verifyGhost(secret, body, String(ts), "sha256=abc", ts)).toBe(false);
  });
  test("a non-numeric timestamp fails", () => {
    expect(verifyGhost(secret, body, "soon", ghostSignature(ts), ts)).toBe(false);
  });
  test("five minutes either way", () => {
    expect(verifyGhost(secret, body, String(ts), ghostSignature(ts), ts + 300)).toBe(true);
    expect(verifyGhost(secret, body, String(ts), ghostSignature(ts), ts - 300)).toBe(true);
    expect(verifyGhost(secret, body, String(ts), ghostSignature(ts), ts + 301)).toBe(false);
    expect(verifyGhost(secret, body, String(ts), ghostSignature(ts), ts - 301)).toBe(false);
  });
  test("another secret fails", () => {
    expect(verifyGhost("other", body, String(ts), ghostSignature(ts), ts)).toBe(false);
  });
});

describe("GitHub", () => {
  test("valid", () => {
    expect(verifyGitHub(secret, body, hex(body))).toBe(true);
  });
  test("a flipped byte fails", () => {
    const tampered = new Uint8Array(body);
    tampered[2] = (tampered[2] ?? 0) ^ 1;
    expect(verifyGitHub(secret, tampered, hex(body))).toBe(false);
  });
  test("missing header fails", () => {
    expect(verifyGitHub(secret, body, null)).toBe(false);
  });
  test("a signature of another length fails without throwing", () => {
    expect(verifyGitHub(secret, body, "sha256=abc")).toBe(false);
  });
  test("another secret fails", () => {
    expect(verifyGitHub("other", body, hex(body))).toBe(false);
  });
});
