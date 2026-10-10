import { describe, expect, it } from 'vitest';

import { callbackMatches } from './callback.js';

const registered = 'https://tool.example:8443/oauth/callback';

describe('callbackMatches', () => {
  it.each([
    ['the registered callback itself', registered],
    ['a path under it', 'https://tool.example:8443/oauth/callback/github'],
    ['a query string on it', 'https://tool.example:8443/oauth/callback?next=%2Fhome'],
  ])('accepts %s', (_, given) => {
    expect(callbackMatches(registered, given)).toBe(true);
  });

  it.each([
    ['another host', 'https://evil.example:8443/oauth/callback'],
    ['a subdomain', 'https://sub.tool.example:8443/oauth/callback'],
    ['another port', 'https://tool.example:9443/oauth/callback'],
    ['another scheme', 'http://tool.example:8443/oauth/callback'],
    ['a sibling path', 'https://tool.example:8443/oauth/other'],
    ['a path that only shares a prefix', 'https://tool.example:8443/oauth/callbackevil'],
    ['a path that climbs out', 'https://tool.example:8443/oauth/callback/../../steal'],
    ['userinfo in the URL', 'https://me@tool.example:8443/oauth/callback'],
    ['a fragment', 'https://tool.example:8443/oauth/callback#x'],
    ['something that is not a URL', 'not a url'],
  ])('refuses %s', (_, given) => {
    expect(callbackMatches(registered, given)).toBe(false);
  });

  it('treats a callback ending in a slash as the directory it names', () => {
    expect(callbackMatches('https://tool.example/cb/', 'https://tool.example/cb/github')).toBe(true);
    expect(callbackMatches('https://tool.example/cb/', 'https://tool.example/cbx')).toBe(false);
  });
});
