import { createCipheriv, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

import type { EventType } from '../events/events.js';

/** Events an endpoint can subscribe to. `ping` is sent on create and on demand, whatever the endpoint chose. */
export const webhookEvents = [
  'push',
  'issue.opened',
  'issue.closed',
  'issue.reopened',
  'issue.assigned',
  'issue.commented',
  'pull_request.merged',
  'pull_request.reviewed',
  'pull_request.review_commented',
] as const satisfies readonly EventType[];

export type WebhookEvent = (typeof webhookEvents)[number];

/** A new signing secret, shown to the user once. */
export function newWebhookSecret() {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

/** Encrypted, not hashed: apps/delivery needs the secret to sign. The format, `v1:` + base64(nonce || ciphertext || tag), is what Go's `gcm.Open` reads. */
export function sealWebhookSecret(key: Buffer, secret: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const sealed = Buffer.concat([
    nonce,
    cipher.update(secret, 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return `v1:${sealed.toString('base64')}`;
}

/** The key from `WEBHOOK_SECRET_KEY`: 32 bytes, base64-encoded. */
export function webhookSecretKey(value: string | undefined) {
  const key = value ? Buffer.from(value, 'base64') : undefined;
  return key?.length === 32 ? key : undefined;
}

// Mirrors apps/delivery/ssrf.go. Delivery checks the address it actually dials on every send; this check only gives a clear error when the endpoint is saved.
const alwaysBlocked = new BlockList();
alwaysBlocked.addSubnet('0.0.0.0', 8, 'ipv4');
alwaysBlocked.addSubnet('169.254.0.0', 16, 'ipv4');
alwaysBlocked.addSubnet('224.0.0.0', 4, 'ipv4');
alwaysBlocked.addSubnet('fe80::', 10, 'ipv6');
alwaysBlocked.addSubnet('ff00::', 8, 'ipv6');
alwaysBlocked.addAddress('::', 'ipv6');

const privateNetworks = new BlockList();
privateNetworks.addSubnet('10.0.0.0', 8, 'ipv4');
privateNetworks.addSubnet('172.16.0.0', 12, 'ipv4');
privateNetworks.addSubnet('192.168.0.0', 16, 'ipv4');
privateNetworks.addSubnet('127.0.0.0', 8, 'ipv4');
privateNetworks.addSubnet('100.64.0.0', 10, 'ipv4');
privateNetworks.addSubnet('fc00::', 7, 'ipv6');
privateNetworks.addAddress('::1', 'ipv6');

export function blockedAddress(address: string, allowPrivate: boolean) {
  // ::ffff:10.0.0.1 is 10.0.0.1
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  const ip = mapped ?? address;
  const family = isIP(ip) === 6 ? 'ipv6' : 'ipv4';
  if (alwaysBlocked.check(ip, family)) return true;
  return !allowPrivate && privateNetworks.check(ip, family);
}

/** Why `url` cannot be a webhook endpoint, or null when it can. */
export async function webhookUrlProblem(
  url: string,
  allowPrivate: boolean,
): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Enter a full URL, such as https://example.com/webhook.';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return 'The URL must start with https:// or http://.';
  }
  if (parsed.username || parsed.password) {
    return 'The URL cannot contain a username or password.';
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  try {
    addresses = isIP(host)
      ? [host]
      : (await lookup(host, { all: true })).map((entry) => entry.address);
  } catch {
    return `${host} does not resolve.`;
  }
  if (addresses.some((address) => blockedAddress(address, allowPrivate))) {
    return `${host} points to a private or reserved address, which webhooks cannot reach.`;
  }
  return null;
}

/** Whose webhooks these are, once the requester was checked as its admin. `name` is how URLs spell it: `owner/repo` or the organization's slug. */
export type WebhookOwner =
  | { repositoryId: string; name: string }
  | { organizationId: string; name: string };
