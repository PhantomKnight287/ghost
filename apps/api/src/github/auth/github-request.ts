import type { Request } from 'express';

export type GithubViewer = {
  userId: string;
  scopes: readonly string[];
  /** The OAuth app the key was minted for; null for keys made in Ghost and for a browser session. */
  oauthClientId: string | null;
};

/** A Ghost App that proved itself with a JWT signed by one of its private keys. */
export type GithubApp = { appId: string; numericId: number };

export type GithubRequest = Request & {
  githubViewer: GithubViewer | null;
  githubApp: GithubApp | null;
};

/** The repository a REST path names, and who is asking. */
export type GithubRepositoryTarget = {
  owner: string;
  repo: string;
  viewer: GithubViewer | null;
};
