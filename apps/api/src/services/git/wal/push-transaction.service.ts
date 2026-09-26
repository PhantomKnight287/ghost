import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import type { GitRequestBody } from '../../../lib/git/protocol/git-request-body.js';

import { encodeEntryHeader } from '../../../lib/git/wal/wal-codec.js';
import { WalStoreService } from './wal-store.service.js';
import {
  NonFastForwardError,
  RepositoryDeletedError,
  WalContentionError,
} from '../../../lib/git/wal/wal.errors.js';
import {
  applyTransitions,
  emptyIndex,
  ZERO_OID,
  type RefTransition,
  type WalIndex,
} from '../../../lib/git/wal/wal.types.js';
import { createUlid } from '../../../lib/git/wal/ulid.js';
import {
  pushBytesTotal,
  pushesTotal,
  refUpdatesTotal,
} from '../../../lib/metrics.js';

const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 50;
const MAX_BACKOFF_MS = 1000;

export interface CommitPushOptions {
  repoId: string;
  transitions: RefTransition[];
  /** The whole request body; the packfile starts at `packOffset`. */
  body: GitRequestBody;
  packOffset: number;
  pushedBy?: string | null;
}

export interface CommitPushResult {
  seq: number;
  ulid: string;
}

@Injectable()
export class PushTransactionService {
  private readonly logger = new Logger(PushTransactionService.name);

  constructor(private readonly store: WalStoreService) {}

  async commitPush({
    repoId,
    transitions,
    body,
    packOffset,
    pushedBy = null,
  }: CommitPushOptions): Promise<CommitPushResult> {
    const ulid = createUlid();
    const packSize = body.size - packOffset;
    const packHash = createHash('sha256');
    await pipeline(body.open(packOffset), packHash);
    const packSha = packHash.digest();

    // Durable before the loop: expensive, idempotent, and unaffected by ordering. A rejected push removes it again; one orphaned by a crash is garbage, never corruption.
    await this.store.putEntry(
      repoId,
      ulid,
      encodeEntryHeader({ ulid, createdAt: Date.now(), pushedBy, transitions }),
      body,
      packOffset,
    );

    try {
      return await this.commitIndex({
        repoId,
        transitions,
        ulid,
        packSha,
        packSize,
      });
    } catch (error) {
      // Only a verdict that the entry was not committed: a failed CAS request may still have landed, and deleting its entry would corrupt the log.
      if (
        error instanceof NonFastForwardError ||
        error instanceof WalContentionError ||
        error instanceof RepositoryDeletedError
      )
        await this.store.deleteEntry(repoId, ulid);
      throw error;
    }
  }

  private async commitIndex({
    repoId,
    transitions,
    ulid,
    packSha,
    packSize,
  }: {
    repoId: string;
    transitions: RefTransition[];
    ulid: string;
    packSha: Buffer;
    packSize: number;
  }): Promise<CommitPushResult> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const current = await this.store.readIndex(repoId);
      const index = current?.index ?? emptyIndex();

      if (index.layers.some((layer) => layer.ulid === ulid)) {
        return { seq: seqOfLayer(index, ulid), ulid };
      }

      this.assertFastForward(index, transitions);

      const next: WalIndex = {
        seq: index.seq + 1,
        compactedThroughSeq: index.compactedThroughSeq,
        refs: applyTransitions(index.refs, transitions),
        layers: [...index.layers, { ulid, packSha, size: packSize }],
        deleted: false,
      };

      if (await this.store.casIndex(repoId, next, current?.etag ?? null)) {
        pushesTotal.add(1);
        pushBytesTotal.add(packSize);
        refUpdatesTotal.add(transitions.length);
        return { seq: next.seq, ulid };
      }

      this.logger.debug(`CAS lost for ${repoId}, attempt ${attempt + 1}`);
      await sleep(backoffMs(attempt));
    }

    throw new WalContentionError(repoId);
  }

  private assertFastForward(index: WalIndex, transitions: RefTransition[]) {
    for (const transition of transitions) {
      const live = index.refs.get(transition.ref) ?? ZERO_OID;
      if (!live.equals(transition.oldOid)) {
        throw new NonFastForwardError(transition.ref);
      }
    }
  }
}

function seqOfLayer(index: WalIndex, ulid: string) {
  return (
    index.compactedThroughSeq +
    index.layers.findIndex((layer) => layer.ulid === ulid) +
    1
  );
}

function backoffMs(attempt: number) {
  const ceiling = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return Math.round(ceiling * (0.5 + Math.random()));
}
