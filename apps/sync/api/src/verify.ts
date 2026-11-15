import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_SECONDS = 300;

const matches = (secret: string, signed: Uint8Array, signature: string | null) => {
  if (!signature) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(signed).digest("hex")}`);
  const received = Buffer.from(signature);
  // timingSafeEqual throws on buffers of different length.
  return expected.length === received.length && timingSafeEqual(expected, received);
};

export const verifyGhost = (
  secret: string,
  body: Uint8Array,
  timestamp: string | null,
  signature: string | null,
  now: number,
) => {
  if (!timestamp) return false;
  const sent = Number(timestamp);
  if (!Number.isInteger(sent) || Math.abs(now - sent) > TOLERANCE_SECONDS) return false;
  return matches(secret, Buffer.concat([Buffer.from(`${timestamp}.`), body]), signature);
};

export const verifyGitHub = (secret: string, body: Uint8Array, signature: string | null) =>
  matches(secret, body, signature);
