import type { ReactNode } from "react";

export type RepositoryParent = {
  username: string;
  slug: string;
  name: string;
};

export type RepositoryFrameProps = {
  viewer: string;
  username: string;
  slug: string;
  name: string;
  description?: string | null;
  visibility: string;
  defaultBranch: string | null;
  branches?: string[];
  starCount: number;
  viewerHasStarred: boolean;
  forkCount: number;
  /** Open requests only, shown on the Pull requests tab. */
  openPullRequestCount?: number;
  parent?: RepositoryParent | null;
  children: ReactNode;
};
