import { Injectable, Logger } from '@nestjs/common';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runGit } from '../../../lib/git/exec/run-git.js';
import { WalStoreService } from '../wal/wal-store.service.js';
import { emptyIndex, type WalIndex } from '../../../lib/git/wal/wal.types.js';

const SEQ_MARKER = 'ghost-wal-seq';
const DEFAULT_BRANCH_PREFERENCE = ['refs/heads/main', 'refs/heads/master'];

/**
 * Brings a cached bare repository up to the state the log describes.
 *
 * The cache is only ever behind the log, never ahead of it, so replay is always forward-only: apply the packfiles of every layer past the cached sequence, then reconcile refs to the index snapshot.
 */
@Injectable()
export class RepositoryMaterializerService {
  private readonly logger = new Logger(RepositoryMaterializerService.name);
  private readonly inFlight = new Map<string, Promise<WalIndex>>();

  constructor(private readonly store: WalStoreService) {}

  async materialize(
    repoId: string,
    repoDirectory: string,
    defaultBranch: string | null,
  ): Promise<WalIndex> {
    const pending = this.inFlight.get(repoId);
    if (pending) return pending;

    const run = this.replay(repoId, repoDirectory, defaultBranch).finally(() =>
      this.inFlight.delete(repoId),
    );
    this.inFlight.set(repoId, run);
    return run;
  }

  /** Resolves once a replay in flight has finished, whatever its outcome, so its writes cannot land after the cache is removed. */
  async settle(repoId: string) {
    await this.inFlight.get(repoId)?.catch(() => undefined);
  }

  private async replay(
    repoId: string,
    repoDirectory: string,
    defaultBranch: string | null,
  ): Promise<WalIndex> {
    const stored = await this.store.readIndex(repoId);
    if (!stored) return emptyIndex();

    const { index } = stored;
    const cachedSeq = await this.readCachedSeq(repoDirectory);
    // The default branch changes without a push, so HEAD is checked even when the cache is current.
    if (cachedSeq >= index.seq) {
      await this.ensureHead(repoDirectory, index, defaultBranch);
      return index;
    }

    for (const [offset, layer] of index.layers.entries()) {
      const seq = index.compactedThroughSeq + offset + 1;
      if (seq <= cachedSeq) continue;

      // Packs from receive-pack are thin: deltas may reference objects from earlier layers, which is why replay must stay in sequence order.
      if (layer.size > 0) {
        await runGit({
          args: ['index-pack', '--fix-thin', '--stdin'],
          gitDir: repoDirectory,
          input: await this.store.openEntryPack(repoId, layer.ulid),
        });
      }
    }

    await this.reconcileRefs(repoDirectory, index);
    await this.ensureHead(repoDirectory, index, defaultBranch);
    await this.writeCachedSeq(repoDirectory, index.seq);
    this.logger.log(
      `Materialized ${repoId} from seq ${cachedSeq} to ${index.seq}`,
    );

    return index;
  }

  private async reconcileRefs(repoDirectory: string, index: WalIndex) {
    const existing = await this.listRefs(repoDirectory);
    const commands: string[] = [];

    for (const [ref, oid] of index.refs) {
      commands.push(`update ${ref} ${oid.toString('hex')}`);
    }
    for (const ref of existing) {
      if (!index.refs.has(ref)) commands.push(`delete ${ref}`);
    }

    if (commands.length > 0) {
      await runGit({
        args: ['update-ref', '--stdin'],
        gitDir: repoDirectory,
        input: Buffer.from(commands.join('\n') + '\n', 'utf8'),
      });
    }
  }

  private async listRefs(repoDirectory: string) {
    const output = await runGit({
      args: ['for-each-ref', '--format=%(refname)'],
      gitDir: repoDirectory,
    });
    return output.split('\n').filter(Boolean);
  }

  /** HEAD follows the chosen default branch while it exists. Otherwise a HEAD naming a missing branch clones as empty, so it is pointed at a branch that actually exists. */
  private async ensureHead(
    repoDirectory: string,
    index: WalIndex,
    defaultBranch: string | null,
  ) {
    if (index.refs.size === 0) return;

    const current = (
      await runGit({
        args: ['symbolic-ref', '--quiet', 'HEAD'],
        gitDir: repoDirectory,
      }).catch(() => '')
    ).trim();

    const chosen = defaultBranch && `refs/heads/${defaultBranch}`;
    const target =
      [chosen, current, ...DEFAULT_BRANCH_PREFERENCE].find(
        (ref) => ref && index.refs.has(ref),
      ) ?? [...index.refs.keys()].find((ref) => ref.startsWith('refs/heads/'));
    if (!target || target === current) return;

    await runGit({
      args: ['symbolic-ref', 'HEAD', target],
      gitDir: repoDirectory,
    });
  }

  private seqMarkerPath(repoDirectory: string) {
    return path.join(repoDirectory, SEQ_MARKER);
  }

  private async readCachedSeq(repoDirectory: string) {
    try {
      const raw = await readFile(this.seqMarkerPath(repoDirectory), 'utf8');
      const seq = Number.parseInt(raw.trim(), 10);
      return Number.isInteger(seq) && seq >= 0 ? seq : 0;
    } catch {
      return 0;
    }
  }

  private async writeCachedSeq(repoDirectory: string, seq: number) {
    await writeFile(this.seqMarkerPath(repoDirectory), `${seq}\n`, 'utf8');
  }
}
