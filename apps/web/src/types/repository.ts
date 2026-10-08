import type { ReactNode } from "react";

import type { WatchLevel } from "@/components/notifications/common";
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
  /** How the viewer watches the repository; null for a signed-out visitor. */
  watchLevel: WatchLevel | null;
  forkCount: number;
  /** Open requests only, shown on the Pull requests tab. */
  openPullRequestCount?: number;
  /** Open issues only, shown on the Issues tab. */
  openIssueCount?: number;
  parent?: RepositoryParent | null;
  /** Whether the file tree beside a file starts collapsed, from the viewer's cookie. */
  fileTreeCollapsed: boolean;
  /** Second column on the repository root, under the listing on a phone. */
  sidebar?: ReactNode;
  children: ReactNode;
};
