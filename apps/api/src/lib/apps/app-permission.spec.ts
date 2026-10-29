import type { Request } from 'express';
import { describe, expect, it } from 'vitest';

import { gitContentsLevel } from '../git/git-push.js';
import { neededLevels } from './app-permission.js';

const request = (fields: Partial<Request>) =>
  ({ query: {}, body: undefined, ...fields }) as Request;

describe('neededLevels', () => {
  it('reads a permission name at the level the method implies', () => {
    for (const method of ['GET', 'HEAD'])
      expect(neededLevels('issues', request({ method }))).toEqual({
        issues: 'read',
      });
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE'])
      expect(neededLevels('issues', request({ method }))).toEqual({
        issues: 'write',
      });
  });

  it('takes stated levels as they are, whatever the method', () => {
    expect(
      neededLevels(
        { pull_requests: 'write', contents: 'read' },
        request({ method: 'GET' }),
      ),
    ).toEqual({ pull_requests: 'write', contents: 'read' });
  });

  it('asks git for write only when it pushes', () => {
    const needs = { contents: gitContentsLevel };
    const level = (fields: Partial<Request>) =>
      neededLevels(needs, request(fields)).contents;

    expect(level({ method: 'POST', path: '/o/r.git/git-receive-pack' })).toBe(
      'write',
    );
    expect(
      level({
        method: 'GET',
        path: '/o/r.git/info/refs',
        query: { service: 'git-receive-pack' },
      }),
    ).toBe('write');
    expect(
      level({
        method: 'POST',
        path: '/o/r.git/info/lfs/objects/batch',
        body: { operation: 'upload' },
      }),
    ).toBe('write');
    expect(level({ method: 'POST', path: '/o/r.git/git-upload-pack' })).toBe(
      'read',
    );
    expect(
      level({
        method: 'GET',
        path: '/o/r.git/info/refs',
        query: { service: 'git-upload-pack' },
      }),
    ).toBe('read');
  });
});
