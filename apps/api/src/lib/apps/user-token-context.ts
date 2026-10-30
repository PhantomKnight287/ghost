import { AsyncLocalStorage } from 'node:async_hooks';

/** Who a `ghu_` token acts as, and which app it acts through. */
export type UserToServerCaller = {
  tokenId: string;
  appId: string;
  userId: string;
};

/** The app behind the request's `ghu_` token, for the whole request, so every write can record that it came through the app. */
export const userToServerCaller = new AsyncLocalStorage<UserToServerCaller>();
