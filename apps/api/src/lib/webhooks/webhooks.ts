import { createCipheriv, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

import type { schema } from '@ghost/db';

import type { EventType } from '../events/events.js';
import type { Commit } from '../git/commits/list-commits.js';

/** Events an endpoint can subscribe to. `ping` is sent on create and on demand, whatever the endpoint chose. */
export const webhookEvents = [
  'push',
  'issue.opened',
  'issue.edited',
  'issue.closed',
  'issue.reopened',
  'issue.assigned',
  'issue.unassigned',
  'issue.labeled',
  'issue.unlabeled',
  'issue.commented',
  'issue.comment_edited',
  'issue.comment_deleted',
  'pull_request.ready_for_review',
  'pull_request.converted_to_draft',
  'pull_request.synchronized',
  'pull_request.merged',
  'pull_request.reviewed',
  'pull_request.review_dismissed',
  'pull_request.review_commented',
  'label.created',
  'label.edited',
  'label.deleted',
  'release.created',
  'release.published',
  'release.edited',
  'release.deleted',
  'star.created',
  'star.deleted',
  'watch.started',
  'fork.created',
  'repository.edited',
  'repository.transferred',
  'member.added',
  'member.removed',
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

type UserRef = {
  id: string;
  username: string | null;
  avatarUrl: string | null;
  /** The profile page, null without a username. */
  htmlUrl: string | null;
};

export type WebhookRepository = {
  id: string;
  fullName: string;
  description: string | null;
  visibility: (typeof schema.repository.$inferSelect)['visibility'];
  defaultBranch: string | null;
  htmlUrl: string;
};

type WebhookThread = {
  id: string;
  number: number;
  title: string;
  body: string | null;
  state: (typeof schema.issue.$inferSelect)['state'];
  author: UserRef | null;
  htmlUrl: string;
};

/** The JSON a receiver gets for an event. Which optional fields are set depends on the event. */
export type WebhookBody = {
  event: EventType;
  repository: WebhookRepository;
  sender: UserRef | null;
  createdAt: string;
  issue?: WebhookThread;
  pullRequest?: WebhookThread;
  comment?: { id: string; body: string; path?: string };
  review?: {
    id: string;
    state: (typeof schema.pullRequestReview.$inferSelect)['state'];
    body: string | null;
    dismissalMessage: string | null;
  };
  assignee?: UserRef;
  member?: UserRef;
  label?: {
    id: string;
    name: string;
    description: string | null;
    color: string;
  };
  /** A deleted release carries only its id, tag and name. */
  release?: {
    id: string;
    tagName: string;
    name: string | null;
    body?: string | null;
    isDraft?: boolean;
    isPrerelease?: boolean;
    publishedAt?: Date | null;
    htmlUrl?: string;
  };
  fork?: WebhookRepository;
  /** The previous owner of a transferred repository. */
  from?: string;
  ref?: string;
  before?: string;
  after?: string;
  created?: boolean;
  deleted?: boolean;
  /** A synchronized request's push rewrote its branch. */
  forced?: boolean;
  commits?: Commit[];
};

/** Sent on create and from the "Send test" button. */
export type WebhookPing = {
  event: 'ping';
  webhook: { id: string; url: string; events: string[] };
  repository?: { fullName: string };
  organization?: { slug: string };
  createdAt: string;
};
