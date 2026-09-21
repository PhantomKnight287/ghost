// Every field is a big-endian

export class Cursor {
  private off = 0;

  constructor(readonly buffer: Buffer) {}

  u8(value: number) {
    this.buffer.writeUInt8(value, this.off);
    this.off += 1;
  }

  u16(value: number) {
    this.buffer.writeUInt16BE(value, this.off);
    this.off += 2;
  }

  u32(value: number) {
    this.buffer.writeUInt32BE(value, this.off);
    this.off += 4;
  }

  u64(value: number) {
    this.buffer.writeBigUInt64BE(BigInt(value), this.off);
    this.off += 8;
  }

  bytes(value: Buffer) {
    value.copy(this.buffer, this.off);
    this.off += value.length;
  }

  str(value: string) {
    const encoded = Buffer.from(value, 'utf8');
    this.u16(encoded.length);
    this.bytes(encoded);
  }

  get offset() {
    return this.off;
  }
}

export class Reader {
  constructor(
    private readonly buffer: Buffer,
    private off = 0,
  ) {}

  u8() {
    const value = this.buffer.readUInt8(this.off);
    this.off += 1;
    return value;
  }

  u16() {
    const value = this.buffer.readUInt16BE(this.off);
    this.off += 2;
    return value;
  }

  u32() {
    const value = this.buffer.readUInt32BE(this.off);
    this.off += 4;
    return value;
  }

  u64() {
    const value = this.buffer.readBigUInt64BE(this.off);
    this.off += 8;
    return Number(value);
  }

  bytes(length: number) {
    if (this.off + length > this.buffer.length) {
      throw new RangeError('read past end of buffer');
    }
    const value = this.buffer.subarray(this.off, this.off + length);
    this.off += length;
    return value;
  }

  str() {
    return this.bytes(this.u16()).toString('utf8');
  }

  get offset() {
    return this.off;
  }
}
