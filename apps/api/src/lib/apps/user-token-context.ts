import { AsyncLocalStorage } from 'node:async_hooks';

import type { AppPermissions } from '@ghost/permissions';

/** What a scoped token is narrowed to; each null narrows nothing. */
export type TokenScope = {
  installationId: string | null;
  permissions: AppPermissions | null;
  repositoryIds: string[] | null;
};

/** Who a `ghu_` token acts as, and which app it acts through. */
export type UserToServerCaller = TokenScope & {
  tokenId: string;
  appId: string;
  userId: string;
};

/** The app behind the request's `ghu_` token, for the whole request, so every write can record that it came through the app. */
export const userToServerCaller = new AsyncLocalStorage<UserToServerCaller>();
