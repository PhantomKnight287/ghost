import type { Readable } from 'node:stream';

import { runGit, runGitBuffer, runGitReadable } from '../exec/run-git.js';

/** Past this a file is a download, not something a page renders. */
export const MAX_BLOB_BYTES = 1024 * 1024;

export interface Blob {
  oid: string;
  size: number;
  /** null when the file is larger than {@link MAX_BLOB_BYTES}. */
  content: Buffer | null;
}

/**
 * Object id and size of a file at a ref, or null when the path is missing or is
 * not a file - one 404 for the caller either way.
 */
export async function statBlob({
  gitDir,
  ref,
  path,
}: {
  gitDir: string;
  ref: string;
  path: string;
}): Promise<{ oid: string; size: number } | null> {
  const stat = await runGit({
    args: ['cat-file', '--batch-check'],
    gitDir,
    // stdin keeps the revision out of argv, where a path could pass for a flag
    input: Buffer.from(`${ref}:${path}\n`, 'utf8'),
  });

  // "<oid> <type> <size>", or "<rev> missing"
  const [oid, type, size] = stat.trim().split(' ');
  return type === 'blob' ? { oid, size: Number(size) } : null;
}

/** A single file at a ref, read into memory up to {@link MAX_BLOB_BYTES}. */
export async function readBlob(args: {
  gitDir: string;
  ref: string;
  path: string;
}): Promise<Blob | null> {
  const blob = await statBlob(args);
  if (!blob) return null;
  if (blob.size > MAX_BLOB_BYTES) return { ...blob, content: null };

  return {
    ...blob,
    content: await runGitBuffer({
      args: ['cat-file', 'blob', blob.oid],
      gitDir: args.gitDir,
    }),
  };
}

/** The same bytes, streamed, with no size limit. */
export function streamBlob({
  gitDir,
  oid,
}: {
  gitDir: string;
  oid: string;
}): Readable {
  return runGitReadable({ args: ['cat-file', 'blob', oid], gitDir });
}
