import { FLUSH_PACKET } from './pkt-line.js';
import { pktLine } from './pkt-line.js';

const SIDE_BAND_DATA = 1;
// The packet limits git sets for each side-band capability, less the length and the band byte.
const SIDE_BAND_64K_CHUNK = 65520 - 5;
const SIDE_BAND_CHUNK = 1000 - 5;

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

  const chunk = capabilities.includes('side-band-64k')
    ? SIDE_BAND_64K_CHUNK
    : capabilities.includes('side-band')
      ? SIDE_BAND_CHUNK
      : null;
  if (chunk === null) return report;

  const packets: Buffer[] = [];
  for (let start = 0; start < report.length; start += chunk) {
    packets.push(
      pktLine(
        Buffer.concat([
          Buffer.from([SIDE_BAND_DATA]),
          report.subarray(start, start + chunk),
        ]),
      ),
    );
  }
  return Buffer.concat([...packets, Buffer.from(FLUSH_PACKET)]);
}
