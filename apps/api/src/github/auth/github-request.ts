import type { AppPermissions } from '@ghost/permissions';
import type { Request } from 'express';

/** The installation behind a `ghs_` token, narrowed as the token was minted. */
export type AppInstallationCaller = {
  installationId: string;
  numericId: number;
  appId: string;
  botUserId: string;
  permissions: AppPermissions;
  /** Null: every repository of the installation. */
  repositoryIds: string[] | null;
};

export type GithubViewer = {
  userId: string;
  scopes: readonly string[];
  /** The OAuth app the key was minted for; null for keys made in Ghost and for a browser session. */
  oauthClientId: string | null;
  /** Set for an installation token, whose viewer is the app's bot; what it may do is AppPermissionGuard's to decide. */
  installation?: AppInstallationCaller | null;
};

/** A Ghost App that proved itself with a JWT signed by one of its private keys. */
export type GithubApp = { appId: string; numericId: number };

export type GithubRequest = Request & {
  githubViewer: GithubViewer | null;
  githubApp: GithubApp | null;
  appInstallation?: AppInstallationCaller | null;
};

/** The repository a REST path names, and who is asking. */
export type GithubRepositoryTarget = {
  owner: string;
  repo: string;
  viewer: GithubViewer | null;
};
