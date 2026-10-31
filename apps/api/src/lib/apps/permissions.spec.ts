import { describe, expect, it } from 'vitest';

import {
  appPermissionsProblem,
  commonPermissions,
  grants,
  withMetadata,
} from './permissions.js';

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

describe('appPermissionsProblem and events', () => {
  it('refuses an installation event', () => {
    expect(appPermissionsProblem({}, ['installation.created'])).toBe(
      'installation.created is not an event',
    );
  });

  it('refuses pull_request.opened without pull_requests', () => {
    expect(appPermissionsProblem({}, ['pull_request.opened'])).toBe(
      'pull_request.opened needs pull_requests:read',
    );
    expect(
      appPermissionsProblem({ pull_requests: 'read' }, ['pull_request.opened']),
    ).toBeNull();
  });
});

describe('commonPermissions', () => {
  it('keeps each permission at the lower of its two levels and drops what one side lacks', () => {
    expect(
      commonPermissions(
        { metadata: 'read', issues: 'write', contents: 'write', statuses: 'read' },
        { issues: 'read', contents: 'write', pull_requests: 'write' },
      ),
    ).toEqual({ metadata: 'read', issues: 'read', contents: 'write' });
  });
});
