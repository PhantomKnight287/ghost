import { Readable } from 'node:stream';
import { buffer as readStream } from 'node:stream/consumers';

import { prefixed, type GitRequestBody } from '../protocol/git-request-body.js';
import { decodeEntryHeader, decodeIndex, encodeIndex } from '../wal/wal-codec.js';
import type { WalIndex } from '../wal/wal.types.js';

/** In-memory stand-in for object storage that keeps the real codec and CAS semantics. */
export class InMemoryWalStore {
  private readonly objects = new Map<string, Buffer>();
  private readonly etags = new Map<string, string>();
  private version = 0;

  async readIndex(repoId: string) {
    const key = this.indexKey(repoId);
    const stored = this.objects.get(key);
    if (!stored) return null;
    return { index: decodeIndex(stored), etag: this.etags.get(key)! };
  }

  async casIndex(repoId: string, next: WalIndex, etag: string | null) {
    const key = this.indexKey(repoId);
    const current = this.etags.get(key) ?? null;
    if (current !== etag) return false;

    this.objects.set(key, encodeIndex(next));
    this.etags.set(key, `"${++this.version}"`);
    return true;
  }

  async putEntry(
    repoId: string,
    ulid: string,
    header: Buffer,
    pack: GitRequestBody,
    packStart = 0,
  ) {
    this.objects.set(
      this.entryKey(repoId, ulid),
      await readStream(prefixed(header, pack, packStart)),
    );
  }

  async openEntryPack(repoId: string, ulid: string) {
    const stored = this.objects.get(this.entryKey(repoId, ulid))!;
    return Readable.from(stored.subarray(decodeEntryHeader(stored).packOffset));
  }

  async readEntryHeader(repoId: string, ulid: string) {
    const stored = this.objects.get(this.entryKey(repoId, ulid));
    return stored ? decodeEntryHeader(stored).header : null;
  }

  private indexKey(repoId: string) {
    return `repos/${repoId}/index`;
  }

  private entryKey(repoId: string, ulid: string) {
    return `repos/${repoId}/entries/${ulid}.pack`;
  }
}
