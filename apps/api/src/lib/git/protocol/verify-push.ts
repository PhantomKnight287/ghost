import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { GitCommandFailedError } from '../exec/exec.errors.js';
import { runGit } from '../exec/run-git.js';
import { OID_LENGTH, type RefTransition, ZERO_OID } from '../wal/wal.types.js';
import { fileBody, type GitRequestBody } from './git-request-body.js';
import { PushRejectedError } from './protocol.errors.js';

const OID_HEX_LENGTH = OID_LENGTH * 2;

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

  const quarantine = await mkdtemp(path.join(tmpdir(), 'ghost-quarantine-'));
  try {
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
  } finally {
    await rm(quarantine, { recursive: true, force: true });
  }
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

  const types = (
    await runGit({
      args: ['cat-file', '--batch-check=%(objecttype)'],
      gitDir,
      env,
      input: Buffer.from(`${oids.join('\n')}\n`),
    })
  )
    .trim()
    .split('\n');
  for (const [index, { ref }] of updates.entries()) {
    const type = types[index].split(' ').at(-1);
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

  // ponytail: holds the name of every new object in memory. Stream it into cat-file if pushes of millions of objects show up.
  const reached = (
    await runGit({
      args: ['rev-list', '--objects', ...oids, '--not', '--all'],
      gitDir,
      env,
    }).catch(refuse('the push does not carry every object its refs reach'))
  )
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(0, OID_HEX_LENGTH));
  if (reached.length === 0) return;

  // The cache holds objects the log does not, such as the trees merge-tree writes, so an object only it holds cannot satisfy a ref.
  const missing = quarantine
    ? (
        await runGit({
          args: ['cat-file', '--batch-check=%(objectname) %(objecttype)'],
          gitDir,
          env: {
            GIT_OBJECT_DIRECTORY: quarantine,
            GIT_ALTERNATE_OBJECT_DIRECTORIES: '',
          },
          input: Buffer.from(`${reached.join('\n')}\n`),
        })
      )
        .trim()
        .split('\n')
        .find((line) => line.endsWith(' missing'))
    : reached[0];
  if (missing) {
    throw new PushRejectedError(
      `${missing.split(' ')[0]} is reachable from the pushed refs but was not in the push`,
    );
  }
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
