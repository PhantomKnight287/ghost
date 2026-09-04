export const OID_LENGTH = 20;
export const PACK_SHA_LENGTH = 32;
export const ZERO_OID = Buffer.alloc(OID_LENGTH);

export interface RefTransition {
  ref: string;
  oldOid: Buffer;
  newOid: Buffer;
}

export interface WalLayer {
  ulid: string;
  packSha: Buffer;
  size: number;
}

export interface WalIndex {
  seq: number;
  compactedThroughSeq: number;
  refs: Map<string, Buffer>;
  layers: WalLayer[];
}

export interface WalEntryHeader {
  ulid: string;
  createdAt: number;
  pushedBy: string | null;
  transitions: RefTransition[];
}

export function emptyIndex(): WalIndex {
  return { seq: 0, compactedThroughSeq: 0, refs: new Map(), layers: [] };
}

export function applyTransitions(
  refs: Map<string, Buffer>,
  transitions: RefTransition[],
): Map<string, Buffer> {
  const next = new Map(refs);
  for (const { ref, newOid } of transitions) {
    if (newOid.equals(ZERO_OID)) next.delete(ref);
    else next.set(ref, newOid);
  }
  return next;
}
