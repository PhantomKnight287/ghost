export type DiffFile = {
  status: string;
  path: string;
  additions?: number;
  deletions?: number;
  binary?: boolean;
};

export type LazyFileDiffsProps = {
  /** Patch endpoint of the commit or request, queried one `path` at a time. */
  patchUrl: string;
  files: DiffFile[];
};

export type LazyFileDiffProps = {
  patchUrl: string;
  file: DiffFile;
};
