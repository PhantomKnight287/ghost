import { AsyncLocalStorage } from 'node:async_hooks';

import type { AppInstallationCaller } from '../../github/auth/github-request.js';

/** The installation behind the request's `ghs_` token, for the whole request. Repository access reads it so the bot's role comes only from this installation and the token's repositories, however a service reaches a repository: the route's own, a pull request's head, a reference in a body. */
export const installationCaller =
  new AsyncLocalStorage<AppInstallationCaller>();
