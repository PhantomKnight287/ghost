import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { describe, expect, it } from 'vitest';

import { pktLine } from './pkt-line.js';
import { withRemoteMessages } from './side-band.js';

const report = Buffer.concat([
  pktLine(Buffer.concat([Buffer.from([1]), pktLine('unpack ok\n')])),
  pktLine(Buffer.concat([Buffer.from([1]), pktLine('ok refs/heads/topic\n')])),
]);
const hint = pktLine(
  Buffer.concat([Buffer.from([2]), Buffer.from('one\ntwo\n')]),
);

/** Feeds `data` a byte at a time, so no packet arrives whole. */
const trickle = (data: Buffer) =>
  Readable.from([...data].map((byte) => Buffer.from([byte])));

describe('withRemoteMessages', () => {
  it('prints the lines on the progress band ahead of the closing flush', async () => {
    const reply = withRemoteMessages(
      trickle(Buffer.concat([report, Buffer.from('0000')])),
      {
        lines: ['one', 'two'],
        capabilities: ['report-status', 'side-band-64k'],
      },
    );

    expect(await buffer(reply)).toEqual(
      Buffer.concat([report, hint, Buffer.from('0000')]),
    );
  });

  it('splits the lines into packets the plain side band can carry', async () => {
    const reply = withRemoteMessages(Readable.from([Buffer.from('0000')]), {
      lines: ['x'.repeat(1500)],
      capabilities: ['side-band'],
    });

    const data = await buffer(reply);
    expect(data.toString('ascii', 0, 4)).toBe(
      (1000).toString(16).padStart(4, '0'),
    );
    expect(data.subarray(-4).toString()).toBe('0000');
  });

  it('leaves the reply alone when the client has no side band to print on', () => {
    const original = Readable.from([report]);
    expect(
      withRemoteMessages(original, {
        lines: ['one'],
        capabilities: ['report-status'],
      }),
    ).toBe(original);
  });

  it('leaves the reply alone when there is nothing to say', () => {
    const original = Readable.from([report]);
    expect(
      withRemoteMessages(original, {
        lines: [],
        capabilities: ['side-band-64k'],
      }),
    ).toBe(original);
  });

  it('passes a reply it cannot frame through untouched', async () => {
    const garbled = Buffer.concat([report, Buffer.from('zzzz0000')]);
    const reply = withRemoteMessages(trickle(garbled), {
      lines: ['one'],
      capabilities: ['side-band-64k'],
    });

    expect(await buffer(reply)).toEqual(garbled);
  });

  it('passes a reply cut short before its flush through untouched', async () => {
    const cut = Buffer.concat([report, Buffer.from('00')]);
    const reply = withRemoteMessages(Readable.from([cut]), {
      lines: ['one'],
      capabilities: ['side-band-64k'],
    });

    expect(await buffer(reply)).toEqual(cut);
  });

  it('forwards whatever follows the flush as it comes', async () => {
    const reply = withRemoteMessages(
      Readable.from([Buffer.from('0000'), Buffer.from('more')]),
      {
        lines: ['one', 'two'],
        capabilities: ['side-band-64k'],
      },
    );

    expect(await buffer(reply)).toEqual(
      Buffer.concat([hint, Buffer.from('0000more')]),
    );
  });

  it('fails the spliced reply when receive-pack fails', async () => {
    const failing = new Readable({
      read() {
        this.destroy(new Error('receive-pack died'));
      },
    });
    const reply = withRemoteMessages(failing, {
      lines: ['one'],
      capabilities: ['side-band-64k'],
    });

    await expect(buffer(reply)).rejects.toThrow('receive-pack died');
  });
});
