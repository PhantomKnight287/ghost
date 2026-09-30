import { createDecipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  blockedAddress,
  sealWebhookSecret,
  webhookSecretKey,
  webhookUrlProblem,
} from './webhooks.js';

function open(key: Buffer, sealed: string) {
  const data = Buffer.from(sealed.replace(/^v1:/, ''), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(data.length - 16));
  return Buffer.concat([
    decipher.update(data.subarray(12, data.length - 16)),
    decipher.final(),
  ]).toString('utf8');
}

describe('webhook secrets', () => {
  it('seal as v1: nonce, ciphertext, tag, which opens with the same key', () => {
    const key = randomBytes(32);
    const sealed = sealWebhookSecret(key, 'whsec_abc');
    expect(sealed).toMatch(/^v1:/);
    expect(open(key, sealed)).toBe('whsec_abc');
    expect(sealWebhookSecret(key, 'whsec_abc')).not.toBe(sealed);
  });

  it('take only a 32-byte key', () => {
    expect(webhookSecretKey(randomBytes(32).toString('base64'))).toHaveLength(
      32,
    );
    expect(
      webhookSecretKey(randomBytes(16).toString('base64')),
    ).toBeUndefined();
    expect(webhookSecretKey(undefined)).toBeUndefined();
  });
});

describe('webhook addresses', () => {
  it.each([
    ['93.184.216.34', false, false],
    ['127.0.0.1', true, false],
    ['::1', true, false],
    ['10.1.2.3', true, false],
    ['192.168.1.4', true, false],
    ['100.64.0.1', true, false],
    ['fd00::1', true, false],
    ['::ffff:127.0.0.1', true, false],
    ['169.254.169.254', true, true],
    ['fe80::1', true, true],
    ['0.0.0.0', true, true],
  ])(
    '%s: blocked %s, with private networks allowed %s',
    (address, strict, lan) => {
      expect(blockedAddress(address, false)).toBe(strict);
      expect(blockedAddress(address, true)).toBe(lan);
    },
  );

  it('explain what is wrong with a URL', async () => {
    expect(await webhookUrlProblem('https://93.184.216.34/hook', false)).toBe(
      null,
    );
    expect(await webhookUrlProblem('ftp://example.com', false)).toMatch(
      /https:\/\//,
    );
    expect(await webhookUrlProblem('not a url', false)).toMatch(/full URL/);
    expect(await webhookUrlProblem('http://a:b@93.184.216.34', false)).toMatch(
      /username or password/,
    );
    expect(await webhookUrlProblem('http://127.0.0.1:9000', false)).toMatch(
      /private or reserved/,
    );
    expect(await webhookUrlProblem('http://[::1]:9000', false)).toMatch(
      /private or reserved/,
    );
    expect(await webhookUrlProblem('http://127.0.0.1:9000', true)).toBe(null);
  });
});
