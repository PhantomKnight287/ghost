import { EVENT_PERMISSIONS } from '@ghost/permissions';
import { describe, expect, it } from 'vitest';

import { webhookEvents } from '../webhooks/webhooks.js';
import { appPermissionsProblem, grants, withMetadata } from './permissions.js';

describe('grants', () => {
  it('always grants metadata read', () => {
    expect(grants({}, 'metadata', 'read')).toBe(true);
  });

  it('lets write include read, never the other way round', () => {
    expect(grants({ contents: 'write' }, 'contents', 'read')).toBe(true);
    expect(grants({ contents: 'read' }, 'contents', 'write')).toBe(false);
    expect(grants({}, 'issues', 'read')).toBe(false);
  });
});

describe('withMetadata', () => {
  it('adds metadata read to what the app asked for', () => {
    expect(withMetadata({ statuses: 'write' })).toEqual({
      metadata: 'read',
      statuses: 'write',
    });
  });
});

describe('appPermissionsProblem', () => {
  it('accepts permissions from the table and events they cover', () => {
    expect(
      appPermissionsProblem({ issues: 'read' }, ['issue.opened']),
    ).toBeNull();
    expect(
      appPermissionsProblem({ contents: 'write' }, ['push', 'release.created']),
    ).toBeNull();
    expect(appPermissionsProblem({}, ['star.created'])).toBeNull();
  });

  it('refuses a level the permission does not have', () => {
    expect(appPermissionsProblem({ members: 'write' }, [])).toContain(
      'members',
    );
    expect(appPermissionsProblem({ metadata: 'write' }, [])).toContain(
      'metadata',
    );
    expect(appPermissionsProblem({ issues: 'admin' }, [])).toContain('issues');
  });

  it('refuses a permission outside the table', () => {
    expect(appPermissionsProblem({ secrets: 'read' }, [])).toContain('secrets');
  });

  it('refuses an event whose permission the app lacks', () => {
    expect(appPermissionsProblem({}, ['push'])).toBe(
      'push needs contents:read',
    );
  });

  it('refuses an event Ghost does not send', () => {
    expect(appPermissionsProblem({}, ['nope'])).toContain('nope');
  });
});

describe('EVENT_PERMISSIONS', () => {
  it('maps every event Ghost sends, and nothing else', () => {
    expect(Object.keys(EVENT_PERMISSIONS).sort()).toEqual(
      [...webhookEvents].sort(),
    );
  });
});
