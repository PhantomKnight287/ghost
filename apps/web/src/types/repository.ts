import type { ReactNode } from "react";

import type { ViewerRole } from "@/lib/repository-role";

export type RepositoryParent = {
  username: string;
  slug: string;
  name: string;
};

export type RepositoryFrameProps = {
  viewer: string;
  viewerRole: ViewerRole | null;
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
  /** Open issues only, shown on the Issues tab. */
  openIssueCount?: number;
  parent?: RepositoryParent | null;
  /** Second column on the repository root, under the listing on a phone. */
  sidebar?: ReactNode;
  children: ReactNode;
};
