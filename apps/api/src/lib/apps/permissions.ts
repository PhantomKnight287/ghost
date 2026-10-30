import {
  APP_PERMISSIONS,
  type AppPermission,
  type AppPermissions,
} from '@ghost/permissions';
import { WEBHOOK_EVENTS } from '@ghost/webhooks';

export function grants(
  held: AppPermissions,
  permission: AppPermission,
  level: 'read' | 'write',
): boolean {
  if (permission === 'metadata' && level === 'read') return true;
  const heldPermission = held[permission];
  if (level === 'read' && heldPermission === 'write') return true;
  return level === heldPermission;
}

/** The first thing wrong with what an app asks for, as a sentence for the owner, or null. Own keys only: `constructor` and the rest of the prototype are not permissions or events. */
export function appPermissionsProblem(
  permissions: Record<string, string>,
  events: string[],
): string | null {
  for (const [name, level] of Object.entries(permissions)) {
    if (!Object.hasOwn(APP_PERMISSIONS, name))
      return `${name} is not a permission`;
    const levels: readonly string[] = APP_PERMISSIONS[name as AppPermission];
    if (!levels.includes(level)) return `${name} cannot be ${level}`;
  }
  for (const event of events) {
    if (!Object.hasOwn(WEBHOOK_EVENTS, event))
      return `${event} is not an event`;
    const needed =
      WEBHOOK_EVENTS[event as keyof typeof WEBHOOK_EVENTS].permission;
    if (needed !== 'metadata' && !permissions[needed])
      return `${event} needs ${needed}:read`;
  }
  return null;
}

export function withMetadata(permissions: AppPermissions): AppPermissions {
  return {
    metadata: 'read',
    ...permissions,
  };
}
