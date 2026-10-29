import type { AppPermission } from '@ghost/permissions';
import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

type Level = 'read' | 'write';
export type AppPermissionLevel = Level | ((req: Request) => Level);
export type AppPermissionNeeds = Partial<
  Record<AppPermission, AppPermissionLevel>
>;

export const APP_PERMISSION = 'ghost:app-permission';

/** What an installation token needs to call a route; a route that declares nothing, on itself or its controller, is refused to installations. A name takes its level from the HTTP method; an object states every need with its level. A route's declaration replaces its controller's. */
export const RequireAppPermission = (
  needs: AppPermission | AppPermissionNeeds,
) => SetMetadata(APP_PERMISSION, needs);

export function neededLevels(
  needs: AppPermission | AppPermissionNeeds,
  req: Request,
): Partial<Record<AppPermission, Level>> {
  if (typeof needs === 'string')
    return {
      [needs]: req.method === 'GET' || req.method === 'HEAD' ? 'read' : 'write',
    };
  return Object.fromEntries(
    (Object.entries(needs) as [AppPermission, AppPermissionLevel][]).map(
      ([name, level]) => [
        name,
        typeof level === 'function' ? level(req) : level,
      ],
    ),
  );
}
