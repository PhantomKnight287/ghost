import type { components } from "@/lib/api/v1";
import type { LazyFileDiffsProps } from "@/types/diffs";

export type PullRequestFile = components["schemas"]["PullRequestFileDTO"];
export type PullRequestReview = components["schemas"]["PullRequestReviewDTO"];
export type ReviewThread = components["schemas"]["ReviewThreadDTO"];
export type RepositoryBlob =
  components["schemas"]["GetRepositoryBlobResponseDTO"];
export type ReviewComment = components["schemas"]["ReviewCommentRequestDTO"];

export type DiffViewProps = Pick<
  LazyFileDiffsProps,
  "annotations" | "onLineComment"
> & {
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
