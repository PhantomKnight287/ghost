import { Readable, Transform, pipeline } from 'node:stream';

import { FLUSH_PACKET, pktLine } from './pkt-line.js';

export const SIDE_BAND_DATA = 1;
const SIDE_BAND_PROGRESS = 2;
const PKT_LENGTH_CHARS = 4;
// The packet limits git sets for each side-band capability, less the length and the band byte.
const SIDE_BAND_64K_CHUNK = 65520 - 5;
const SIDE_BAND_CHUNK = 1000 - 5;

/** Null when the client negotiated no side band. */
export function sideBandChunk(capabilities: string[]) {
  if (capabilities.includes('side-band-64k')) return SIDE_BAND_64K_CHUNK;
  if (capabilities.includes('side-band')) return SIDE_BAND_CHUNK;
  return null;
}

/** `data` split across as many packets on `band` as the chunk size needs. */
export function sideBandPackets(band: number, data: Buffer, chunk: number) {
  const packets: Buffer[] = [];
  for (let start = 0; start < data.length; start += chunk) {
    packets.push(
      pktLine(
        Buffer.concat([
          Buffer.from([band]),
          data.subarray(start, start + chunk),
        ]),
      ),
    );
  }
  return packets;
}

/** Shows `lines` as `remote:` output, slotted ahead of the flush that ends a side-band receive-pack reply. Without a side band the client has nowhere to print them, so the reply passes through untouched. */
export function withRemoteMessages(
  reply: Readable,
  { lines, capabilities }: { lines: string[]; capabilities: string[] },
): Readable {
  const chunk = sideBandChunk(capabilities);
  if (chunk === null || lines.length === 0) return reply;

  const messages = Buffer.concat(
    sideBandPackets(
      SIDE_BAND_PROGRESS,
      Buffer.from(lines.map((line) => `${line}\n`).join('')),
      chunk,
    ),
  );
  let pending = Buffer.alloc(0);
  let sent = false;

  const splice = new Transform({
    transform(data: Buffer, _encoding, done) {
      if (sent) return done(null, data);
      pending = Buffer.concat([pending, data]);
      let offset = 0;
      while (offset + PKT_LENGTH_CHARS <= pending.length) {
        const marker = pending.toString(
          'ascii',
          offset,
          offset + PKT_LENGTH_CHARS,
        );
        const length = Number.parseInt(marker, 16);
        // Anything but a well-formed packet is git's to explain, so the rest goes through as it came.
        if (marker === FLUSH_PACKET || !(length >= PKT_LENGTH_CHARS)) {
          sent = true;
          const rest = pending;
          pending = Buffer.alloc(0);
          if (marker !== FLUSH_PACKET) return done(null, rest);
          return done(
            null,
            Buffer.concat([
              rest.subarray(0, offset),
              messages,
              rest.subarray(offset),
            ]),
          );
        }
        if (offset + length > pending.length) break;
        offset += length;
      }
      this.push(pending.subarray(0, offset));
      pending = pending.subarray(offset);
      done();
    },
    flush(done) {
      done(null, pending.length > 0 ? pending : undefined);
    },
  });
  // Errors reach the caller through the splice, which `pipe` alone would drop.
  return pipeline(reply, splice, () => {});
}
