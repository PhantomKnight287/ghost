import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Injectable } from '@nestjs/common';

import { GitCommandFailedError } from '../../../lib/git/exec/exec.errors.js';
import { runGit } from '../../../lib/git/exec/run-git.js';
import {
  bufferBody,
  fileBody,
} from '../../../lib/git/protocol/git-request-body.js';
import {
  directoryConflict,
  isWellFormedRef,
} from '../../../lib/git/refs/is-valid-ref-name.js';
import { createUlid } from '../../../lib/git/wal/ulid.js';
import { encodeEntryHeader } from '../../../lib/git/wal/wal-codec.js';
import {
  NonFastForwardError,
  RepositoryDeletedError,
} from '../../../lib/git/wal/wal.errors.js';
import {
  type WalIndex,
  type WalLayer,
  ZERO_OID,
} from '../../../lib/git/wal/wal.types.js';
import { isNotFound } from '../../../lib/s3/s3.errors.js';
import { RepositoryStorageService } from '../repository-storage/repository-storage.service.js';
import { PushTransactionService } from '../wal/push-transaction.service.js';
import { WalStoreService } from '../wal/wal-store.service.js';
import { objectTypes } from '../../../lib/git/exec/object-types.js';

// A repair that loses the index to a push starts over; a repository still being pushed to this often was never broken.
const MAX_ATTEMPTS = 3;
const OID_HEX_LENGTH = 40;

export interface RepairReport {
  /** Entries the log alone could not index. `rebuilt` borrowed its delta bases from the local cache and now replays by itself; `dropped` is skipped by every replay from now on. */
  layers: { ulid: string; outcome: 'rebuilt' | 'dropped'; reason: string }[];
  /** Refs whose missing objects the local cache still held, written back into the log. */
  rescued: string[];
  /** Refs removed because no node could ever replay them. */
  dropped: { ref: string; oid: string; reason: string }[];
}

interface Diagnosis extends RepairReport {
  scratch: string;
  rebuiltPacks: Map<string, string>;
  rescuePack: string | null;
}

/**
 * Finds repositories whose log no node can replay, which makes every clone and push of them fail, and repairs them (0034).
 *
 * The log is replayed into an empty scratch repository rather than checked against the cache: the cache can hold objects the log does not, and so hide exactly the damage being looked for. The cache is only ever a source of objects to put back.
 */
@Injectable()
export class RepositoryRepairService {
  constructor(
    private readonly store: WalStoreService,
    private readonly pushTransaction: PushTransactionService,
    private readonly storage: RepositoryStorageService,
  ) {}

  /** What a repair would change, changing nothing. Null when the log replays cleanly or holds nothing. */
  async check(repositoryId: string): Promise<RepairReport | null> {
    const stored = await this.readIndex(repositoryId);
    if (!stored || stored.index.deleted) return null;
    const diagnosis = await this.diagnose(repositoryId, stored.index);
    try {
      return isHealthy(diagnosis) ? null : report(diagnosis);
    } finally {
      await rm(diagnosis.scratch, { recursive: true, force: true });
    }
  }

  /** Repairs the log so a node holding nothing else can replay it, and says what changed. Null when nothing needed changing. */
  async repair(repositoryId: string): Promise<RepairReport | null> {
    for (let attempt = 1; ; attempt++) {
      const stored = await this.readIndex(repositoryId);
      if (!stored || stored.index.deleted) return null;
      const diagnosis = await this.diagnose(repositoryId, stored.index);
      try {
        if (isHealthy(diagnosis)) return null;
        if (await this.apply(repositoryId, stored, diagnosis)) {
          return report(diagnosis);
        }
      } catch (error) {
        if (!(error instanceof NonFastForwardError)) throw error;
      } finally {
        await rm(diagnosis.scratch, { recursive: true, force: true });
      }
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(`the log kept changing while it was being repaired`);
      }
    }
  }

  private async readIndex(repositoryId: string) {
    try {
      return await this.store.readIndex(repositoryId);
    } catch (error) {
      if (error instanceof RepositoryDeletedError) return null;
      throw error;
    }
  }

  private async diagnose(
    repositoryId: string,
    index: WalIndex,
  ): Promise<Diagnosis> {
    const scratch = await mkdtemp(path.join(tmpdir(), 'ghost-repair-'));
    try {
      await runGit({ args: ['init', '--quiet', '--bare'], gitDir: scratch });
      const cache = await this.storage.getRepoPath(repositoryId);
      const diagnosis: Diagnosis = {
        scratch,
        layers: [],
        rescued: [],
        dropped: [],
        rebuiltPacks: new Map(),
        rescuePack: null,
      };

      for (const layer of index.layers) {
        if (layer.size === 0) continue;
        const replayed = await this.replay(repositoryId, layer, scratch);
        if ('pack' in replayed) continue;
        // The cache can lend the delta bases a thin entry leaned on; the pack index-pack writes then carries them itself.
        const rebuilt = await this.replay(repositoryId, layer, scratch, cache);
        if ('pack' in rebuilt) {
          diagnosis.rebuiltPacks.set(layer.ulid, rebuilt.pack);
          diagnosis.layers.push({
            ulid: layer.ulid,
            outcome: 'rebuilt',
            reason: replayed.failure,
          });
        } else {
          diagnosis.layers.push({
            ulid: layer.ulid,
            outcome: 'dropped',
            reason: rebuilt.failure,
          });
        }
      }

      await this.checkRefs(repositoryId, index, diagnosis, cache);
      return diagnosis;
    } catch (error) {
      await rm(scratch, { recursive: true, force: true });
      throw error;
    }
  }

  private async replay(
    repositoryId: string,
    layer: WalLayer,
    scratch: string,
    lender?: string,
  ): Promise<{ pack: string } | { failure: string }> {
    let input;
    try {
      input = await this.store.openEntryPack(repositoryId, layer.ulid);
    } catch (error) {
      if (isNotFound(error)) {
        return { failure: 'the entry is missing from object storage' };
      }
      throw error;
    }
    return runGit({
      args: ['index-pack', '--fix-thin', '--stdin'],
      gitDir: scratch,
      env: lender
        ? { GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(lender, 'objects') }
        : undefined,
      input,
    }).then(
      // index-pack names the pack it wrote: `pack\t<hash>`
      (out) => ({
        pack: path.join(
          scratch,
          'objects',
          'pack',
          `pack-${out.trim().split('\t').at(-1)}.pack`,
        ),
      }),
      (error: unknown) => {
        if (!(error instanceof GitCommandFailedError)) throw error;
        return {
          failure: error.stderr || `index-pack exited with ${error.exitCode}`,
        };
      },
    );
  }

  private async checkRefs(
    repositoryId: string,
    index: WalIndex,
    diagnosis: Diagnosis,
    cache: string,
  ) {
    const { scratch } = diagnosis;
    const live = new Map(index.refs);
    const drop = (ref: string, reason: string) => {
      diagnosis.dropped.push({
        ref,
        oid: live.get(ref)!.toString('hex'),
        reason,
      });
      live.delete(ref);
    };

    for (const ref of live.keys()) {
      if (!isWellFormedRef(ref)) drop(ref, 'git refuses this name');
    }

    const unreachable = await this.unreachable(scratch, live);
    if (unreachable.length > 0) {
      diagnosis.rescuePack = await this.rescue(
        scratch,
        cache,
        unreachable.map((ref) => live.get(ref)!.toString('hex')),
      );
      for (const ref of await this.unreachable(scratch, live)) {
        drop(ref, 'objects it reaches are in neither the log nor the cache');
      }
      diagnosis.rescued = unreachable.filter((ref) => live.has(ref));
    }

    if (live.size > 0) {
      const refs = [...live.keys()];
      const types = await objectTypes({
        gitDir: scratch,
        oids: refs.map((ref) => live.get(ref)!.toString('hex')),
      });
      for (const [i, type] of types.entries()) {
        if (refs[i].startsWith('refs/heads/') && type !== 'commit') {
          drop(refs[i], `a branch must point at a commit, not a ${type}`);
        }
      }
    }

    for (const ref of live.keys()) {
      if (!live.has(ref)) continue;
      const conflict = directoryConflict(live, ref);
      if (!conflict) continue;
      const later = await this.writtenLater(repositoryId, index, ref, conflict);
      drop(later, `it conflicts with ${later === ref ? conflict : ref}`);
    }
  }

  /** Of two refs that cannot coexist, the one whose entry came later: that push is the one that should never have landed. The deeper name when no entry says. */
  private async writtenLater(
    repositoryId: string,
    index: WalIndex,
    a: string,
    b: string,
  ) {
    for (const layer of [...index.layers].reverse()) {
      const header = await this.store.readEntryHeader(repositoryId, layer.ulid);
      const set = header?.transitions.find(
        ({ ref, newOid }) =>
          (ref === a || ref === b) && !newOid.equals(ZERO_OID),
      );
      if (set) return set.ref;
    }
    return a.length > b.length ? a : b;
  }

  /** The refs whose history the scratch repository cannot walk in full. */
  private async unreachable(scratch: string, refs: Map<string, Buffer>) {
    const walks = (oids: string[]) =>
      // on stdin: thousands of refs overflow argv, and that failure would read as a broken walk
      runGit({
        args: ['rev-list', '--objects', '--quiet', '--stdin'],
        gitDir: scratch,
        input: Buffer.from(`${oids.join('\n')}\n`),
      }).then(
        () => true,
        () => false,
      );
    const entries = [...refs].map(
      ([ref, oid]) => [ref, oid.toString('hex')] as const,
    );
    // ponytail: one walk of every ref, then one per ref only when that fails. A damaged repository with thousands of refs walks its history thousands of times.
    if (entries.length === 0 || (await walks(entries.map(([, oid]) => oid)))) {
      return [];
    }
    const broken: string[] = [];
    for (const [ref, oid] of entries) {
      if (!(await walks([oid]))) broken.push(ref);
    }
    return broken;
  }

  /** Packs whatever the cache holds of `oids`' history that the scratch repository lacks, indexes it there too, and returns the pack; null when the cache has none of it. */
  private async rescue(scratch: string, cache: string, oids: string[]) {
    // Walked in the scratch repository with the cache lent: the tips may exist only in the log, their history only in the cache.
    const reachable = await runGit({
      args: [
        'rev-list',
        '--objects',
        '--missing=allow-any',
        '--ignore-missing',
        '--stdin',
      ],
      gitDir: scratch,
      input: Buffer.from(`${oids.join('\n')}\n`),
      env: { GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(cache, 'objects') },
    });
    const candidates = reachable
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(0, OID_HEX_LENGTH));
    if (candidates.length === 0) return null;

    const present = await runGit({
      args: ['cat-file', '--batch-check=%(objectname) %(objecttype)'],
      gitDir: scratch,
      input: Buffer.from(`${candidates.join('\n')}\n`),
    });
    const absent = present
      .trim()
      .split('\n')
      .filter((line) => line.endsWith(' missing'))
      .map((line) => line.slice(0, OID_HEX_LENGTH));
    if (absent.length === 0) return null;

    const prefix = path.join(scratch, 'rescue');
    const name = await runGit({
      args: ['pack-objects', '--quiet', prefix],
      gitDir: cache,
      input: Buffer.from(`${absent.join('\n')}\n`),
    });
    const pack = `${prefix}-${name.trim()}.pack`;
    await runGit({
      args: ['index-pack', '--stdin'],
      gitDir: scratch,
      input: createReadStream(pack),
    });
    return pack;
  }

  /** Swaps rebuilt and dropped entries into the index in place, so every sequence number stays where caches expect it, then removes dropped refs and adds rescued objects as one ordinary entry. False when a push moved the index first. */
  private async apply(
    repositoryId: string,
    stored: { index: WalIndex; etag: string },
    diagnosis: Diagnosis,
  ) {
    if (diagnosis.layers.length > 0) {
      const layers = await Promise.all(
        stored.index.layers.map(async (layer) => {
          const fix = diagnosis.layers.find(({ ulid }) => ulid === layer.ulid);
          if (!fix) return layer;
          if (fix.outcome === 'dropped') return { ...layer, size: 0 };
          return this.rewrite(
            repositoryId,
            layer.ulid,
            diagnosis.rebuiltPacks.get(layer.ulid)!,
          );
        }),
      );
      const swapped = await this.store.casIndex(
        repositoryId,
        { ...stored.index, layers },
        stored.etag,
      );
      if (!swapped) return false;
    }

    if (diagnosis.dropped.length > 0 || diagnosis.rescuePack) {
      const pack = diagnosis.rescuePack;
      await this.pushTransaction.commitPush({
        repoId: repositoryId,
        transitions: diagnosis.dropped.map(({ ref, oid }) => ({
          ref,
          oldOid: Buffer.from(oid, 'hex'),
          newOid: ZERO_OID,
        })),
        body: pack
          ? fileBody(pack, (await stat(pack)).size)
          : bufferBody(Buffer.alloc(0)),
        packOffset: 0,
      });
    }
    return true;
  }

  /** A new entry holding the rebuilt pack under the old entry's header, so the log still says who pushed it and what it moved. */
  private async rewrite(
    repositoryId: string,
    ulid: string,
    pack: string,
  ): Promise<WalLayer> {
    const header = await this.store.readEntryHeader(repositoryId, ulid);
    const next = createUlid();
    const { size } = await stat(pack);
    await this.store.putEntry(
      repositoryId,
      next,
      encodeEntryHeader({
        ulid: next,
        createdAt: header?.createdAt ?? Date.now(),
        pushedBy: header?.pushedBy ?? null,
        transitions: header?.transitions ?? [],
      }),
      fileBody(pack, size),
      0,
    );
    const hash = createHash('sha256');
    await pipeline(createReadStream(pack), hash);
    return { ulid: next, packSha: hash.digest(), size };
  }
}

function isHealthy({ layers, rescued, dropped }: Diagnosis) {
  return layers.length === 0 && rescued.length === 0 && dropped.length === 0;
}

function report({ layers, rescued, dropped }: Diagnosis): RepairReport {
  return { layers, rescued, dropped };
}
