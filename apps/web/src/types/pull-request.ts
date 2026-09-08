import type { components } from "@/lib/api/v1";

export type PullRequestFile = components["schemas"]["PullRequestFileDTO"];

export type DiffViewProps = {
  from: string;
  to: string;
  files: PullRequestFile[];
  /** Patch endpoint the diffs are fetched from, one path at a time. */
  patchUrl: string;
};

export type CreatePullRequestFormProps = {
  username: string;
  repo: string;
  bases: string[];
  heads: string[];
  defaultBase: string;
  defaultHead: string;
};
