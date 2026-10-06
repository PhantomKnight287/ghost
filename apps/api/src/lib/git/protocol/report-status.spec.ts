import { describe, expect, it } from 'vitest';

import { rejectedPushReport } from './report-status.js';

/** Splits pkt-lines, keeping a flush as an empty payload. */
function packets(data: Buffer) {
  const lines: Buffer[] = [];
  for (let offset = 0; offset < data.length; ) {
    const length = Number.parseInt(
      data.toString('ascii', offset, offset + 4),
      16,
    );
    lines.push(data.subarray(offset + 4, offset + Math.max(length, 4)));
    offset += Math.max(length, 4);
  }
  return lines;
}

describe('rejectedPushReport', () => {
  it('refuses every ref on one line each when the client takes no side band', () => {
    const report = rejectedPushReport({
      refs: ['refs/heads/main', 'refs/tags/v1'],
      capabilities: ['report-status'],
      reason: 'Storage quota exceeded:\n1 KB of 1 KB used',
    })!;

    expect(packets(report).map(String)).toEqual([
      'unpack ok\n',
      'ng refs/heads/main Storage quota exceeded: 1 KB of 1 KB used\n',
      'ng refs/tags/v1 Storage quota exceeded: 1 KB of 1 KB used\n',
      '',
    ]);
  });

  it('wraps the report in side-band packets git can carry', () => {
    const refs = Array.from({ length: 50 }, (_, i) => `refs/heads/b${i}`);
    const plain = rejectedPushReport({
      refs,
      capabilities: ['report-status-v2'],
      reason: 'no',
    })!;
    const banded = rejectedPushReport({
      refs,
      capabilities: ['report-status', 'side-band'],
      reason: 'no',
    })!;

    const outer = packets(banded);
    expect(outer.at(-1)).toHaveLength(0);
    const data = outer.slice(0, -1);
    expect(data.length).toBeGreaterThan(1);
    for (const packet of data) {
      expect(packet[0]).toBe(1);
      expect(packet.length + 4).toBeLessThanOrEqual(1000);
    }
    expect(Buffer.concat(data.map((packet) => packet.subarray(1)))).toEqual(
      plain,
    );
  });

  it('fits a whole report in one side-band-64k packet', () => {
    const report = rejectedPushReport({
      refs: ['refs/heads/main'],
      capabilities: ['report-status', 'side-band-64k'],
      reason: 'no',
    })!;

    expect(packets(report)).toHaveLength(2);
  });

  it('has nothing to say to a client that asked for no report', () => {
    expect(
      rejectedPushReport({
        refs: ['refs/heads/main'],
        capabilities: ['side-band-64k'],
        reason: 'no',
      }),
    ).toBeNull();
  });
});
