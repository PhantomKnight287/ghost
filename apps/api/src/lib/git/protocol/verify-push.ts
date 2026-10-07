import { once } from 'node:events';
import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { GitCommandFailedError } from '../exec/exec.errors.js';
import { runGit, runGitStream } from '../exec/run-git.js';
import { type RefTransition, ZERO_OID } from '../wal/wal.types.js';
import { fileBody, type GitRequestBody } from './git-request-body.js';
import { PushRejectedError } from './protocol.errors.js';
import { withTempDir } from '../../temp-dir.js';
import { splitRecords } from '../exec/split-records.js';
import { objectTypes } from '../exec/object-types.js';

/**
 * Proves a push can be replayed by a node holding only the log, then hands `commit` the pack the log should store (0034).
 *
 * The pack is indexed into a quarantine with the cache lent as an alternate, the way git quarantines a push, and the log stores that indexed pack rather than the thin one received: a thin pack's delta bases come from the cache, which holds objects the log does not.
 */
export async function withVerifiedPack<T>(
  {
    gitDir,
    transitions,
    body,
    packOffset,
  }: {
    gitDir: string;
    transitions: RefTransition[];
    body: GitRequestBody;
    packOffset: number;
  },
  commit: (pack: { body: GitRequestBody; packOffset: number }) => Promise<T>,
): Promise<T> {
  if (body.size === packOffset) {
    if (transitions.some(({ newOid }) => !newOid.equals(ZERO_OID))) {
      await verifyRefs({ gitDir, transitions, quarantine: null });
    }
    return commit({ body, packOffset });
  }

  return await withTempDir('ghost-quarantine-', async (quarantine) => {
    await mkdir(path.join(quarantine, 'pack'));
    // ponytail: the pack is indexed here and again by receive-pack once the log commits it. Move this index into the cache instead if large pushes show it.
    await runGit({
      args: ['index-pack', '--fix-thin', '--stdin'],
      gitDir,
      env: lend(gitDir, quarantine),
      input: body.open(packOffset),
    }).catch(refuse('the pack could not be read'));
    await verifyRefs({ gitDir, transitions, quarantine });

    const [name] = (await readdir(path.join(quarantine, 'pack'))).filter(
      (file) => file.endsWith('.pack'),
    );
    const indexed = path.join(quarantine, 'pack', name);
    return await commit({
      body: fileBody(indexed, (await stat(indexed)).size),
      packOffset: 0,
    });
  });
}

/** Every new ref names an object the repository or the push holds, a branch names a commit, and whatever the refs reach beyond the existing refs arrived in the push itself. */
async function verifyRefs({
  gitDir,
  transitions,
  quarantine,
}: {
  gitDir: string;
  transitions: RefTransition[];
  quarantine: string | null;
}) {
  const updates = transitions.filter(({ newOid }) => !newOid.equals(ZERO_OID));
  const oids = updates.map(({ newOid }) => newOid.toString('hex'));
  const env = quarantine ? lend(gitDir, quarantine) : undefined;

  const types = await objectTypes({ gitDir, oids, env });
  for (const [index, { ref }] of updates.entries()) {
    const type = types[index];
    if (type === 'missing') {
      throw new PushRejectedError(
        `${ref} points at ${oids[index]}, which neither the push nor the repository holds`,
      );
    }
    if (ref.startsWith('refs/heads/') && type !== 'commit') {
      throw new PushRejectedError(
        `${ref} is a branch, so it must point at a commit, not a ${type}`,
      );
    }
  }

  // Streamed end to end: an import's first push reaches millions of objects, whose names alone run to gigabytes as strings.
  const reached = runGitStream({
    // The tips on stdin: an import pushes tens of thousands of refs, past what argv can carry (E2BIG). `--stdin` reads them where it stands, so they stay wanted and only `--all` is negated.
    args: [
      'rev-list',
      '--objects',
      '--no-object-names',
      '--stdin',
      '--not',
      '--all',
    ],
    gitDir,
    env,
    input: Buffer.from(`${oids.join('\n')}\n`),
  });
  // The cache holds objects the log does not, such as the trees merge-tree writes, so an object only it holds cannot satisfy a ref.
  const missing = await (quarantine
    ? firstMissing(gitDir, quarantine, reached)
    : firstLine(reached)
  ).catch(refuse('the push does not carry every object its refs reach'));
  if (missing) {
    throw new PushRejectedError(
      `${missing} is reachable from the pushed refs but was not in the push`,
    );
  }
}

/** The first object `objects` names, or null when it names none. Stops git as soon as it has one. */
async function firstLine(objects: AsyncIterable<string>) {
  let text = '';
  for await (const chunk of objects) {
    text += chunk;
    const end = text.indexOf('\n');
    if (end >= 0) return text.slice(0, end);
  }
  return text.trim() || null;
}

/** The first of `objects` the quarantine lacks, or null. Reads cat-file to the end even after a hit: killing it while its stdin is still being written would raise EPIPE. */
async function firstMissing(
  gitDir: string,
  quarantine: string,
  objects: AsyncIterable<string>,
) {
  const names = new PassThrough();
  const feeding = (async () => {
    try {
      for await (const chunk of objects) {
        if (!names.write(chunk)) await once(names, 'drain');
      }
    } finally {
      // Ended even when rev-list fails, so cat-file finishes and the failure surfaces below.
      names.end();
    }
  })();
  feeding.catch(() => {});

  let missing: string | null = null;
  const lines = splitRecords(
    runGitStream({
      args: ['cat-file', '--batch-check=%(objectname) %(objecttype)'],
      gitDir,
      env: {
        GIT_OBJECT_DIRECTORY: quarantine,
        GIT_ALTERNATE_OBJECT_DIRECTORIES: '',
      },
      input: names,
    }),
    '\n',
  );
  // Read to the end even after a hit, so cat-file is never left blocked on a full pipe.
  for await (const line of lines) {
    if (!missing && line.endsWith(' missing'))
      missing = line.split(' ')[0] ?? null;
  }
  await feeding;
  return missing;
}

function lend(gitDir: string, quarantine: string) {
  return {
    GIT_OBJECT_DIRECTORY: quarantine,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(gitDir, 'objects'),
  };
}

function refuse(reason: string) {
  return (error: unknown): never => {
    if (!(error instanceof GitCommandFailedError)) throw error;
    throw new PushRejectedError(`${reason}: ${error.stderr}`);
  };
}
