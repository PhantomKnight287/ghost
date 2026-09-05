import { describe, expect, it } from 'vitest';

import { InvalidReceivePackRequestError } from './protocol.errors.js';
import { bufferBody } from './git-request-body.js';
import {
  isProbeRequest,
  parseReceivePackRequest,
  readReceivePackHeader,
} from './receive-pack-request.js';

const ZERO = '0'.repeat(40);
const NEW = '55ff3318cbb1ad74a1e1a1e6f4bd91f4b5a9c0d2';

function pkt(payload: string) {
  const length = (Buffer.byteLength(payload) + 4).toString(16).padStart(4, '0');
  return length + payload;
}

function body(lines: string[], pack = Buffer.alloc(0)) {
  return Buffer.concat([Buffer.from(lines.join('') + '0000', 'utf8'), pack]);
}

describe('parseReceivePackRequest', () => {
  it('parses a single ref update with capabilities', () => {
    const request = parseReceivePackRequest(
      body(
        [pkt(`${ZERO} ${NEW} refs/heads/main\0report-status side-band-64k\n`)],
        Buffer.from('PACKPAYLOAD'),
      ),
    );

    expect(request.transitions).toHaveLength(1);
    expect(request.transitions[0].ref).toBe('refs/heads/main');
    expect(request.transitions[0].oldOid).toEqual(Buffer.alloc(20));
    expect(request.transitions[0].newOid).toEqual(Buffer.from(NEW, 'hex'));
    expect(request.capabilities).toContain('side-band-64k');
    expect(request.pack.toString()).toBe('PACKPAYLOAD');
  });

  it('parses a multi-ref atomic push', () => {
    const request = parseReceivePackRequest(
      body([
        pkt(`${ZERO} ${NEW} refs/heads/main\0report-status\n`),
        pkt(`${ZERO} ${NEW} refs/heads/dev\n`),
      ]),
    );

    expect(request.transitions.map((t) => t.ref)).toEqual([
      'refs/heads/main',
      'refs/heads/dev',
    ]);
  });

  it('accepts a delete-only push with no packfile', () => {
    const request = parseReceivePackRequest(
      body([pkt(`${NEW} ${ZERO} refs/heads/stale\n`)]),
    );

    expect(request.pack).toHaveLength(0);
    expect(request.transitions[0].newOid).toEqual(Buffer.alloc(20));
  });

  it('recognises the flush-only probe git sends before a chunked push', async () => {
    expect(await isProbeRequest(bufferBody(Buffer.from('0000')))).toBe(true);
  });

  it('does not mistake a real push for a probe', async () => {
    const push = bufferBody(body([pkt(`${ZERO} ${NEW} refs/heads/main\n`)]));
    expect(await isProbeRequest(push)).toBe(false);
    expect(await isProbeRequest(bufferBody(Buffer.alloc(0)))).toBe(false);
    expect(await isProbeRequest(bufferBody(Buffer.from('0000PACK')))).toBe(
      false,
    );
  });

  it('locates the packfile without reading it', async () => {
    const raw = body(
      [pkt(`${ZERO} ${NEW} refs/heads/main\0report-status\n`)],
      Buffer.from('PACKPAYLOAD'),
    );

    const header = await readReceivePackHeader(bufferBody(raw));

    expect(header.transitions[0].ref).toBe('refs/heads/main');
    expect(header.packSize).toBe('PACKPAYLOAD'.length);
    expect(raw.subarray(header.packOffset).toString()).toBe('PACKPAYLOAD');
  });

  it('rejects a body with no commands', () => {
    expect(() => parseReceivePackRequest(body([]))).toThrow(
      InvalidReceivePackRequestError,
    );
  });

  it('rejects a truncated pkt-line', () => {
    expect(() =>
      parseReceivePackRequest(
        Buffer.from(`00ff${ZERO} ${NEW} refs/heads/main`),
      ),
    ).toThrow(InvalidReceivePackRequestError);
  });

  it('rejects a payload that is not a packfile', () => {
    expect(() =>
      parseReceivePackRequest(
        body(
          [pkt(`${ZERO} ${NEW} refs/heads/main\n`)],
          Buffer.from('NOTAPACK'),
        ),
      ),
    ).toThrow(InvalidReceivePackRequestError);
  });
});
