import { createHmac, generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { decodeAppJwt, verifyAppJwt } from './app-jwt.js';
import { AppJwtError, JWT_UNDECODABLE } from './apps.errors.js';

const now = 1_761_480_000;
const pair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  return {
    privateKey,
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }) as string,
  };
};
const a = pair();
const b = pair();
const encode = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (
  claims: object,
  key = a.privateKey,
  header: object = { alg: 'RS256', typ: 'JWT' },
) => {
  const input = `${encode(header)}.${encode(claims)}`;
  return `${input}.${sign('sha256', Buffer.from(input), key).toString('base64url')}`;
};
const octokit = { iss: 42, iat: now - 30, exp: now + 570 };
const check = (token: string, keys = [a.publicPem]) =>
  verifyAppJwt(token, decodeAppJwt(token), keys, now);
const refusal = (run: () => void) => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppJwtError);
    return (error as Error).message;
  }
  throw new Error('expected the JWT to be refused');
};

describe('app JWTs', () => {
  it('accepts what Octokit signs', () => {
    const token = jwt(octokit);
    expect(decodeAppJwt(token)).toEqual(octokit);
    expect(() => check(token)).not.toThrow();
  });

  it('reads an iss written as a string of digits', () => {
    expect(decodeAppJwt(jwt({ ...octokit, iss: '42' })).iss).toBe(42);
  });

  it('accepts a signature from any current key', () => {
    expect(() =>
      check(jwt(octokit, b.privateKey), [a.publicPem, b.publicPem]),
    ).not.toThrow();
  });

  it('refuses a signature from another key', () => {
    expect(refusal(() => check(jwt(octokit, b.privateKey)))).toBe(
      JWT_UNDECODABLE,
    );
  });

  it('refuses a token with no keys to check it against', () => {
    expect(refusal(() => check(jwt(octokit), []))).toBe(JWT_UNDECODABLE);
  });

  it('refuses alg none', () => {
    const token = `${encode({ alg: 'none' })}.${encode(octokit)}.`;
    expect(refusal(() => check(token))).toBe(JWT_UNDECODABLE);
  });

  it('refuses HS256 signed with the public key as its secret', () => {
    const input = `${encode({ alg: 'HS256' })}.${encode(octokit)}`;
    const token = `${input}.${createHmac('sha256', a.publicPem).update(input).digest('base64url')}`;
    expect(refusal(() => check(token))).toBe(JWT_UNDECODABLE);
  });

  it('refuses tokens that are not JWTs', () => {
    for (const token of ['abc.def.ghi', 'eyJ.eyJ.x', 'not a jwt', ''])
      expect(refusal(() => check(token))).toBe(JWT_UNDECODABLE);
  });

  it('refuses an iss that is not an App ID', () => {
    for (const iss of ['abc', -1, 1.5, null])
      expect(refusal(() => decodeAppJwt(jwt({ ...octokit, iss })))).toBe(
        JWT_UNDECODABLE,
      );
  });

  it('refuses iat or exp that are not integers', () => {
    expect(refusal(() => decodeAppJwt(jwt({ ...octokit, iat: 'soon' })))).toBe(
      JWT_UNDECODABLE,
    );
    expect(
      refusal(() => decodeAppJwt(jwt({ ...octokit, exp: undefined }))),
    ).toBe(
      "'Expiration time' claim ('exp') must be a numeric value representing the future time at which the assertion expires",
    );
  });

  it('allows 60 seconds of clock drift on iat', () => {
    expect(() =>
      check(jwt({ iss: 42, iat: now + 60, exp: now + 600 })),
    ).not.toThrow();
    expect(
      refusal(() => check(jwt({ iss: 42, iat: now + 61, exp: now + 600 }))),
    ).toBe(JWT_UNDECODABLE);
  });

  it('refuses a token that lives more than ten minutes', () => {
    expect(() =>
      check(jwt({ iss: 42, iat: now - 60, exp: now + 540 })),
    ).not.toThrow();
    expect(
      refusal(() => check(jwt({ iss: 42, iat: now - 60, exp: now + 541 }))),
    ).toBe("'Expiration time' claim ('exp') is too far in the future");
  });

  it('refuses an expired token', () => {
    expect(
      refusal(() => check(jwt({ iss: 42, iat: now - 600, exp: now }))),
    ).toBe(
      "'Expiration time' claim ('exp') must be a numeric value representing the future time at which the assertion expires",
    );
  });
});
