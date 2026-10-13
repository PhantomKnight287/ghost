import type { Readable } from 'node:stream';

import { runGitReadable } from '../exec/run-git.js';

export const ARCHIVE_FORMATS = ['zip', 'tar.gz'] as const;
export type ArchiveFormat = (typeof ARCHIVE_FORMATS)[number];

export const ARCHIVE_MEDIA_TYPES: Record<ArchiveFormat, string> = {
  zip: 'application/zip',
  'tar.gz': 'application/gzip',
};

/** `commit` is known before any byte is built, so a conditional request is answered without building the archive. */
export interface SourceArchive {
  commit: string;
  /** A tag or sha: the archive never changes. A branch moves. */
  immutable: boolean;
  filename: string;
  /** `size` is known only for an archive already stored. */
  open(): Promise<{ stream: Readable; size?: number }>;
}

/** `<repo>-<ref>`, as GitHub names it: a branch's slashes become dashes, so the folder is one path segment. */
export function archiveName(repo: string, ref: string) {
  return `${repo}-${ref.replace(/^refs\/(heads|tags)\//, '').replaceAll('/', '-')}`;
}

export function streamArchive({
  gitDir,
  commit,
  format,
  prefix,
}: {
  gitDir: string;
  /** A resolved commit sha; a name could pass for a flag. */
  commit: string;
  format: ArchiveFormat;
  prefix: string;
}): Readable {
  return runGitReadable({
    // git compresses tar.gz itself (2.38+), so there is no gzip process to pipe through
    args: ['archive', `--format=${format}`, `--prefix=${prefix}/`, commit],
    gitDir,
  });
}
