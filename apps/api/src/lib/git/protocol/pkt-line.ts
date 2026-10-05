/** 4 hex digits of total length, then the payload. */
export function pktLine(payload: string | Buffer) {
  const data = typeof payload === 'string' ? Buffer.from(payload) : payload;
  return Buffer.concat([
    Buffer.from((data.length + 4).toString(16).padStart(4, '0'), 'ascii'),
    data,
  ]);
}
