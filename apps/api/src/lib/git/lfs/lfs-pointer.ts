import { runGit, runGitBuffer } from '../exec/run-git.js';

/** The spec caps a pointer file at 1024 bytes, so anything larger is never one. */
export const LFS_POINTER_MAX_BYTES = 1024;

/** The object a pointer file names, or null when `content` is not a pointer. */
export function parseLfsPointer(content: Buffer) {
  if (content.length > LFS_POINTER_MAX_BYTES) return null;
  const text = content.toString('utf8');
  if (!text.startsWith('version https://git-lfs.github.com/spec/v1\n')) {
    return null;
  }
  const oid = /^oid sha256:([0-9a-f]{64})$/m.exec(text)?.[1];
  const size = /^size (\d+)$/m.exec(text)?.[1];
  return oid && size ? { oid, size: Number(size) } : null;
}

/** Oids of the LFS objects named by pointer files that `include` reaches and `exclude` does not. */
export async function lfsPointersIn({
  gitDir,
  include,
  exclude,
}: {
  gitDir: string;
  include: string[];
  exclude: string[];
}) {
  const listed = await runGit({
    gitDir,
    args: [
      'rev-list',
      '--objects',
      '--no-object-names',
      `--filter=blob:limit=${LFS_POINTER_MAX_BYTES + 1}`,
      ...include,
      '--not',
      ...exclude,
    ],
  });
  const blobs = (
    await runGit({
      gitDir,
      args: ['cat-file', '--batch-check=%(objecttype) %(objectname)'],
      input: Buffer.from(listed),
    })
  )
    .split('\n')
    .filter((line) => line.startsWith('blob '))
    .map((line) => line.slice('blob '.length));
  if (blobs.length === 0) return [];

  // "<oid> blob <size>\n<content>\n" per blob
  const output = await runGitBuffer({
    gitDir,
    args: ['cat-file', '--batch'],
    input: Buffer.from(`${blobs.join('\n')}\n`),
  });
  const oids = new Set<string>();
  for (let offset = 0; offset < output.length; ) {
    const headerEnd = output.indexOf(0x0a, offset);
    const size = Number(
      output.subarray(offset, headerEnd).toString().split(' ')[2],
    );
    const pointer = parseLfsPointer(
      output.subarray(headerEnd + 1, headerEnd + 1 + size),
    );
    if (pointer) oids.add(pointer.oid);
    offset = headerEnd + 1 + size + 1;
  }
  return [...oids];
}
