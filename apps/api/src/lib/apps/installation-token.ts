import { createHash, randomInt } from 'node:crypto';

import {
  APP_PERMISSIONS,
  type AppPermission,
  type AppPermissions,
} from '@ghost/permissions';

import { InstallationPermissionsError } from './apps.errors.js';
import { grants } from './permissions.js';

/** GitHub's installation token shape, so tools that sniff prefixes treat it as one. */
export const INSTALLATION_TOKEN = /^ghs_[A-Za-z0-9]{36}$/;
export const INSTALLATION_TOKEN_TTL_MS = 60 * 60 * 1000;

const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function generateInstallationToken() {
  const token = `ghs_${Array.from({ length: 36 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`;
  return { token, hash: hashInstallationToken(token) };
}

export function hashInstallationToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

/** What a token minted with `requested` may do: GitHub's `permissions` body field lowers the installation's grant and never raises it. */
export function narrowPermissions(
  granted: AppPermissions,
  requested: Record<string, string> | undefined,
): AppPermissions {
  if (!requested) return granted;
  for (const [name, level] of Object.entries(requested)) {
    if (
      !Object.hasOwn(APP_PERMISSIONS, name) ||
      (level !== 'read' && level !== 'write') ||
      !grants(granted, name as AppPermission, level)
    )
      throw new InstallationPermissionsError();
  }
  return { metadata: 'read', ...(requested as AppPermissions) };
}
