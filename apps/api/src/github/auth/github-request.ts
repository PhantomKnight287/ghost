import type { Request } from 'express';

export type GithubViewer = {
  userId: string;
  scopes: readonly string[];
  /** The OAuth app the key was minted for; null for keys made in Ghost and for a browser session. */
  oauthClientId: string | null;
};

export type GithubRequest = Request & { githubViewer: GithubViewer | null };

/** The repository a REST path names, and who is asking. */
export type GithubRepositoryTarget = {
  owner: string;
  repo: string;
  viewer: GithubViewer | null;
};
