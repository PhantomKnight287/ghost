import { FLUSH_PACKET, pktLine } from './pkt-line.js';
import { SIDE_BAND_DATA, sideBandChunk, sideBandPackets } from './side-band.js';

/** A receive-pack reply that refuses every ref in a push, which git prints as `! [remote rejected] <ref> (<reason>)`. Null when the client asked for no report, so the caller has nothing better than an error status. */
export function rejectedPushReport({
  refs,
  capabilities,
  reason,
}: {
  refs: string[];
  capabilities: string[];
  reason: string;
}): Buffer | null {
  if (
    !capabilities.includes('report-status') &&
    !capabilities.includes('report-status-v2')
  )
    return null;

  // A reason runs to the end of its line, so it must not break one.
  const line = reason.replace(/\s+/g, ' ').trim();
  const report = Buffer.concat([
    pktLine('unpack ok\n'),
    ...refs.map((ref) => pktLine(`ng ${ref} ${line}\n`)),
    Buffer.from(FLUSH_PACKET),
  ]);

  const chunk = sideBandChunk(capabilities);
  if (chunk === null) return report;

  return Buffer.concat([
    ...sideBandPackets(SIDE_BAND_DATA, report, chunk),
    Buffer.from(FLUSH_PACKET),
  ]);
}
