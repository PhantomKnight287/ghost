import { describe, expect, it } from 'vitest';

import { InstallationPermissionsError } from './apps.errors.js';
import {
  generateInstallationToken,
  hashInstallationToken,
  INSTALLATION_TOKEN,
  narrowPermissions,
} from './installation-token.js';

describe('generateInstallationToken', () => {
  it('makes a ghs_ token and its sha256', () => {
    const { token, hash } = generateInstallationToken();

    expect(token).toMatch(INSTALLATION_TOKEN);
    expect(hash).toBe(hashInstallationToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never makes the same token twice', () => {
    expect(generateInstallationToken().token).not.toBe(
      generateInstallationToken().token,
    );
  });
});

describe('narrowPermissions', () => {
  const granted = { metadata: 'read', issues: 'write' } as const;

  it('keeps the grant when nothing is asked', () => {
    expect(narrowPermissions(granted, undefined)).toEqual(granted);
  });

  it('lowers to what is asked, keeping metadata', () => {
    expect(narrowPermissions(granted, { issues: 'read' })).toEqual({
      metadata: 'read',
      issues: 'read',
    });
  });

  it('refuses more than the grant', () => {
    expect(() =>
      narrowPermissions({ issues: 'read' }, { issues: 'write' }),
    ).toThrow(InstallationPermissionsError);
    expect(() =>
      narrowPermissions({ issues: 'read' }, { contents: 'read' }),
    ).toThrow(InstallationPermissionsError);
  });

  it('refuses what is not a permission', () => {
    expect(() => narrowPermissions({}, { secrets: 'read' })).toThrow(
      InstallationPermissionsError,
    );
    expect(() => narrowPermissions({}, { constructor: 'read' })).toThrow(
      InstallationPermissionsError,
    );
  });
});
