import type {
  DiffLineAnnotation,
  SelectedLineRange,
} from "@pierre/diffs/react";
import type { ReactNode } from "react";

export type DiffFile = {
  status: string;
  path: string;
  additions?: number;
  deletions?: number;
  binary?: boolean;
};

export type LineAnnotations = DiffLineAnnotation<ReactNode>[];

export type LineCommentHandler = (
  path: string,
  range: SelectedLineRange,
) => void;

export type LazyFileDiffsProps = {
  /** Patch endpoint of the commit or request, queried one `path` at a time. */
  patchUrl: string;
  files: DiffFile[];
  /** Rendered under the lines they point at, keyed by path. */
  annotations?: Record<string, LineAnnotations>;
  /** Shows a comment button in the gutter and receives the lines it picked. */
  onLineComment?: LineCommentHandler;
};

export type LazyFileDiffProps = {
  patchUrl: string;
  file: DiffFile;
  annotations?: LineAnnotations;
  onLineComment?: LineCommentHandler;
};
