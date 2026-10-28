import {
  APP_PERMISSIONS,
  type AppPermission,
  type AppPermissions,
  EVENT_PERMISSIONS,
} from '@ghost/permissions';

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
    if (!Object.hasOwn(EVENT_PERMISSIONS, event))
      return `${event} is not an event`;
    const needed = EVENT_PERMISSIONS[event]!;
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
