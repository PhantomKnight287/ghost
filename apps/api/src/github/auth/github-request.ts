import type { Request } from 'express';

export type GithubViewer = { userId: string; scopes: readonly string[] };

export type GithubRequest = Request & { githubViewer: GithubViewer | null };
